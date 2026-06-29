---
date: 2026-05-31
tags:
  - "Note"
  - "GAS"
summary: "GAS 预测"
order: 5
---

# GAS设计解析五：GAS预测

前面几篇把 ASC、Attribute、GE、Ability 和 Tag 的关系基本铺开了。预测这一篇要回答的是另一类问题：在多人游戏里，客户端按下技能以后，为什么不用等服务端往返确认就能立刻看到反馈；如果服务端最后拒绝了这次操作，客户端又如何把刚才提前做过的事情撤掉。

GAS 的预测可以理解为：

1. 先让客户端提前执行一部分逻辑，然后给这些逻辑产生的副作用打上同一个 PredictionKey。
2. 服务端随后执行权威逻辑。如果服务端接受，客户端把本地预测结果追平到服务端结果；
3. 如果服务端拒绝，客户端把这批预测副作用撤掉。

这个思路和 UE 网络层的基本模型一致：客户端可以发起请求和提前表现，服务端决定最终结果。

## PredictionKey 的复制规则

`FPredictionKey` 的主要字段是 `Current`、`Base` 和 `bIsServerInitiated`。`Current` 表示当前预测动作的 Key。`Base` 用来描述预测动作之间的依赖关系：如果在已有 Key 的窗口里又生成新 Key，新 Key 会沿着旧 Key 建立一条 Key 链。这样前面的预测动作被拒绝时，依赖它产生的后续预测副作用也能跟着被拒绝或清理。`bIsServerInitiated` 则表示这个 Key 由服务端发起，用于服务端发起的同步流程。

源码里更值得关注的是 `FPredictionKey::NetSerialize`。它有一条非常关键的规则：客户端把 PredictionKey 发给服务端时，Key 会正常序列化过去；服务端把带 PredictionKey 的属性复制回客户端时，只有最初发起预测的客户端会收到这个 Key，其他客户端会收到无效 Key。这个判断通过 `PredictiveConnectionObjectKey` 完成。这样做的原因很明确。PredictionKey 是预测客户端用来回滚和追平的本地凭证，其他客户端不参与这次预测，也不需要知道这次权威结果对应哪个本地预测动作。其他客户端只需要看服务端最终复制出的 Ability、GE、Attribute、Cue、Tag 状态即可。

## 预测窗口：把副作用归到同一个 Key 下

GAS 使用 `FScopedPredictionWindow` 管理一个预测窗口。预测窗口的作用不是“让代码变得可预测”这么抽象，而是很具体：在这一段调用范围里，把 ASC 的 `ScopedPredictionKey` 设成当前 Key。后续应用 GE、触发 GameplayCue、发送某些 Ability RPC 时，就能从 ASC 上拿到这个 Key，并把自己归到同一批预测副作用里。

`FScopedPredictionWindow` 是一个 RAII 对象，也就是构造时进入窗口，析构时离开窗口。具体来说，它构造时保存旧的 `ScopedPredictionKey`，再写入新的 PredictionKey；析构时恢复旧 Key。服务端版本在析构时还会把 Key 写入 `ReplicatedPredictionKeyMap`，用来通知预测客户端：这个 Key 在服务端已经处理过，可以进行 CatchUp。

客户端常见构造方式是：

```cpp
FScopedPredictionWindow ScopedPredictionWindow(this, true);
```

这个构造会在客户端生成新的 PredictionKey。如果当前已经有一个有效的 `ScopedPredictionKey`，新 Key 会基于旧 Key 生成依赖关系。可以把它想成一条预测链，例如一个预测 Ability 又立刻触发了另一个预测 Ability：

```text
Ability X Key: 100
Ability Y Key: 101，Base 指向 100
Ability Z Key: 102，Base 仍然追随 100
```

这条链的意义是：后续预测动作不是孤立发生的，它们可以追随前面的预测动作。这里的 Base 更像整条链的起点，相邻 Key 之间的依赖主要由客户端本地回调维护。比如 Ability Y 被服务端拒绝，那么依赖它产生的 Ability Z 相关预测副作用也不应该继续成立。GAS 会通过 PredictionKey 的依赖关系和回调，把 Reject/CatchUp 传递到相关的预测副作用上。服务端处理时仍然以 RPC 传来的 Key 打开对应逻辑范围。

服务端常见构造方式是：

```cpp
FScopedPredictionWindow ScopedPredictionWindow(this, PredictionKey);
```

服务端使用客户端 RPC 带来的 Key 打开同一逻辑范围。这样服务端在这段范围内应用的 GE、触发的 Cue 等副作用，也会带着同一个 Key。客户端本地已经预测过一份，服务端又复制回来一份时，系统才能知道“这是同一件事”，从而做撤销、追平和去重。

这里有一个很容易忽略的边界：预测窗口只覆盖当前调用范围。Ability 初始激活时打开的预测窗口，不会自动覆盖所有后续 AbilityTask 回调、Timer 回调或输入释放。`GameplayPrediction.h` 里专门用 `WaitInputRelease` 举例：客户端在输入释放回调里如果还要预测新的副作用，需要重新打开预测窗口，生成新的 Key，并通过 RPC 把这个 Key 传给服务端。服务端处理这个 RPC 时，也要用同一个 Key 打开窗口。

这就是很多“为什么我在 Ability 里应用 GE 却没有预测”的根源。代码仍然写在同一个 Ability 类中，但逻辑已经跨帧，最初的预测窗口早就结束了。

## Ability 激活时的预测主线

以 `LocalPredicted` Ability 为例，客户端从 `TryActivateAbility` 进入。`TryActivateAbility` 会先处理网络策略：如果当前不是本地控制端，不能直接激活 LocalOnly 或 LocalPredicted；如果是 ServerOnly 或 ServerInitiated，则客户端只能请求服务端。真正进入 `InternalTryActivateAbility` 后，系统完成 ActorInfo、网络角色、AbilitySpec、实例策略、CanActivateAbility 等检查。通过检查后，LocalPredicted 分支会打开预测窗口。

源码中的关键流程可以压缩成：

```cpp
FScopedPredictionWindow ScopedPredictionWindow(this, true);

ActivationInfo.SetPredicting(ScopedPredictionKey);

CallServerTryActivateAbility(Handle, Spec->InputPressed, ScopedPredictionKey);

AbilitySource->CallActivateAbility(
	Handle,
	ActorInfo,
	ActivationInfo,
	OnGameplayAbilityEndedDelegate,
	TriggerEventData
);
```

这几行说明了预测激活的本质。客户端先创建 PredictionKey，把当前激活信息标记为 Predicting，然后立即把这个 Key 发给服务端，同时本地继续执行 `CallActivateAbility`。玩家按下按钮后马上播放动画、进入技能流程，就是从这里来的。

服务端收到 `ServerTryActivateAbility` 后，会进入 `InternalServerTryActivateAbility`。它会找到对应 AbilitySpec，消费客户端已经复制过来的目标数据或输入数据，然后用客户端传来的 PredictionKey 打开服务端预测窗口，再调用 `InternalTryActivateAbility` 执行权威激活。简化后的主线是：

```cpp
FScopedPredictionWindow ScopedPredictionWindow(this, PredictionKey);

if (InternalTryActivateAbility(Handle, PredictionKey, ...))
{
	// 成功，后续由激活流程和复制追平
}
else
{
	ClientActivateAbilityFailed(Handle, PredictionKey.Current);
}
```

如果服务端拒绝激活，客户端会收到 `ClientActivateAbilityFailed`。这个 RPC 的实现会广播：

```cpp
FPredictionKeyDelegates::BroadcastRejectedDelegate(PredictionKey);
```

所有绑定到这个 PredictionKey 的预测副作用都会收到拒绝通知。预测 GE 会移除，预测 Cue 会清理，Ability 实例也会被结束。这个过程就是 Undo。

如果服务端接受激活，它会调用 `ClientActivateAbilitySucceed` 或带 EventData 的成功 RPC。但成功 RPC 不是完整追平。真正表示“服务端带这个 Key 的复制结果已经追上客户端”的，是 `ReplicatedPredictionKeyMap`。服务端 `FScopedPredictionWindow` 析构时会把 Key 写入这个 Map；它复制到预测客户端后，会触发：

```cpp
FPredictionKeyDelegates::BroadcastCaughtUpDelegate(PredictionKey);
```

客户端收到 CatchUp 后，清理本地预测副作用，保留服务端权威复制结果。可以把两条消息分开理解：`ClientActivateAbilitySucceed` 是服务端说“这次激活我接受了”，`ReplicatedPredictionKeyMap` 是服务端说“带这个 Key 的权威结果已经复制到了。”

## GameplayEffect 如何预测

GE 的预测入口首先看权限。`UAbilitySystemComponent::HasNetworkAuthorityToApplyGameplayEffect` 的逻辑很短：

```cpp
return IsOwnerActorAuthoritative() || PredictionKey.IsValidForMorePrediction();
```

服务端当然有权应用 GE。客户端没有权威，但如果当前持有有效 PredictionKey，就可以预测应用 GE。没有权威也没有 PredictionKey 时，客户端应用 GE 会被拒绝。

`ApplyGameplayEffectSpecToSelf` 中还有几条重要规则。

第一，Periodic GameplayEffect 不能预测。周期执行依赖服务端时间和重复触发，客户端提前模拟很容易产生次数、时间和回滚上的复杂问题，所以源码里会直接拒绝预测 Periodic GE。

第二，客户端预测 Instant GE 时，会把它临时当作 Infinite GE 放进 ActiveGameplayEffects：

```cpp
bool bTreatAsInfiniteDuration =
	GetOwnerRole() != ROLE_Authority
	&& PredictionKey.IsLocalClientKey()
	&& Spec.Def->DurationPolicy == Instant;
```

其实很好理解，Instant GE 正常执行完就没有 ActiveGameplayEffect 了，已经宣告结束。而预测需要一个可追踪、可撤销、可 CatchUp 的对象。客户端把预测 Instant GE 临时作为 Infinite GE 保存起来，后续如果 Key 被 Reject 或 CaughtUp，再把这个临时 ActiveGameplayEffect 移除。

在 `FActiveGameplayEffectsContainer::ApplyGameplayEffectSpec` 中，客户端预测添加 AGE 时会绑定 PredictionKey 的回调。Reject 时调用 `OnRejectedActiveGameplayEffect`，CatchUp 时调用 `OnCaughtUpActiveGameplayEffect`。这两个回调最后都会移除本地预测 AGE，只是语义不同：Reject 是服务端拒绝，本地效果应该撤销；CatchUp 是服务端接受且权威结果到了，本地临时效果应该让位给权威结果。

服务端复制回来的 `FActiveGameplayEffect` 也会携带同一个 PredictionKey。预测客户端收到后，`FActiveGameplayEffect::PostReplicatedAdd` 会判断本地是否已经有同 Key 的预测效果，并抑制一部分 GameplayCue Applied 事件，避免同一个效果播放两次。这就是 Redo 问题的处理。

## Attribute 为什么能提前变化

客户端预测应用 GE 后，Attribute 会在本地提前变化。比如预测一个 Instant Damage GE，客户端 Health 会先扣掉，UI 立刻响应。服务端稍后计算并复制权威属性值回来。如果客户端预测值和服务端不同，客户端会被修正。

这也是预测 Instant GE 临时转 Infinite 的原因之一。客户端需要一个临时 ActiveGameplayEffect 代表“这次本地预测的属性修正”。CatchUp 到来后，这个临时修正被移除，服务端复制的最终属性值成为权威结果。

我们之前提到在GE修改属性这一章里提到，Modifier可以被预测，Execution不能被预测，可以更详细的解释一下：Modifier 可以预测，是因为它结构受限：一个 Attribute、一个 Op、一个 Magnitude。只要客户端拥有同样输入，客户端可以先得到同样的属性修正。AttributeBased 和 MMC 也可以参与预测，但前提是客户端能拿到一致的捕获属性、Tag 和 SetByCaller 数据。而ExecutionCalculation 不能预测，是因为它允许执行任意项目代码，可以读取复杂上下文并输出多个属性修改。GAS 不假设客户端一定拥有和服务端相同的数据，也不试图合并客户端和服务端各自执行出的复杂结果。因此 Execution 更适合作为服务端结算点，客户端可以预测表现，但不应该预测最终属性结果。

## GameplayCue 和 Tag 的去重

GameplayCue 的预测和 GE 类似，也是围绕 PredictionKey 做去重和清理。客户端在预测窗口中添加 Cue 时，会走 PredictiveAdd，并把 Cue 的清理绑定到 PredictionKey 的 Reject 或 CatchUp 上。服务端复制或 Multicast Cue 时，如果发现这是预测客户端本地已经处理过的 Key，就会避免重复触发。

`GameplayCueInterface.cpp` 中可以看到这条主线：`PredictiveAdd` 更新本地 Cue 状态并注册 PredictionKey 回调，`PostReplicatedAdd` 对本地预测 Key 做特殊处理，NetMulticast Cue 在预测客户端上会跳过已经本地预测过的事件。这样一个技能本地预测播放了命中特效，服务端复制回来时不会再播放一遍。

GameplayTag 通常跟随 GE 或 Ability 状态一起预测。预测 GE 授予的 Tag 会先出现在客户端，用于本地 UI、输入和 Ability 判断。服务端结果追平后，Tag 状态以权威复制为准。比如冲刺 Ability 预测授予 `State.Dashing`，客户端可以立刻进入冲刺表现；如果服务端拒绝，Tag 被撤销，表现回滚。

## 什么适合预测

适合预测的内容，一般有两个条件：客户端需要即时反馈，并且这件事的输入足够明确，结果可以被回滚或追平。`LocalPredicted` Ability 的初始激活、Ability 激活调用栈内应用的 Modifier GE、GameplayCue、ActivationOwnedTags、简单资源消耗和冷却，都属于 GAS 预测重点覆盖的范围。

不适合预测的内容通常也很明显。ServerOnly Ability 不预测。Periodic GE 不预测。ExecutionCalculation 不预测。依赖服务端隐藏数据、复杂命中验证、反作弊判断、不可复现随机结果的逻辑不应该依赖客户端预测出最终权威结果。客户端可以先做表现层反馈，例如动画、镜头、音效、临时 UI，但最终玩法状态仍然由服务端复制决定。

跨帧预测要特别小心。Ability 初始激活时的预测窗口只覆盖当时的调用栈。AbilityTask 后续回调如果还要预测 GE 或 Cue，就需要新的 PredictionKey，并通过对应 Server RPC 把 Key 交给服务端。这一点和 UE 网络文章里“本地先做、RPC 到服务端、服务端复制回来追平”的思路一致，只是 GAS 把 Key、回调和副作用管理封装好了。

## 举个栗子

把前面的内容串起来，一个 LocalPredicted 火球技能可以这样理解。

玩家按下输入，本地 ASC 调用 `TryActivateAbility`，找到 `GA_Fireball` 的 AbilitySpec。因为这是本地控制端，并且 Ability 是 LocalPredicted，系统进入 `InternalTryActivateAbility` 的预测分支。客户端打开 `FScopedPredictionWindow`，生成 PredictionKey，把 ActivationInfo 标记为 Predicting，立刻发送 `ServerTryActivateAbility`，同时本地执行 `CallActivateAbility`。

Ability 本地开始播放施法动画，可能授予 `State.Casting`，触发一个预测 GameplayCue。若在同一预测窗口内应用 Cost GE 或 Cooldown GE，这些 GE 也会带上同一个 PredictionKey。客户端 UI 看到 Mana 减少、技能进入冷却、动画开始播放。玩家获得了即时反馈。

服务端稍后收到 RPC，用客户端传来的 PredictionKey 打开服务端预测窗口，重新跑 `CanActivateAbility`、Commit、GE 应用等权威逻辑。如果服务端发现角色已经眩晕、Mana 不足、目标非法，激活失败，服务端发送 `ClientActivateAbilityFailed`。客户端收到后广播 Rejected Delegate，之前带这个 Key 的预测 GE、Cue、Ability 状态被撤销。

如果服务端接受，服务端执行 Ability 并复制权威GE、Attribute、Cue、Tag 状态。预测客户端收到带同一个 PredictionKey 的权威结果时，系统知道它对应本地已有预测副作用，于是避免重复播放 Cue。随后 `ReplicatedPredictionKeyMap` 复制到客户端，广播 CaughtUp Delegate，本地预测用的临时 AGE 和 Cue 记录被清理。最终客户端显示服务端权威状态。

## 其他

* 预测不是同步。预测让客户端提前表现，真正状态仍然来自服务端复制

* 一个 Ability 类中的所有逻辑不一定都在预测窗口里。跨帧、异步 Task、输入释放、目标数据返回，都需要重新考虑 PredictionKey 的范围。

* Modifier 可以预测，不代表结果永远正确。客户端输入和服务端输入不一致时，服务端仍然会覆盖。Execution 不能预测，是因为它太自由，不适合作为客户端可复现的提前结算。

## 总结

GAS 预测的主线可以概括为：客户端生成 PredictionKey，在预测窗口中本地执行 Ability、GE、Cue 和 Tag 副作用；同一个 Key 通过 RPC 发给服务端；服务端用这个 Key 执行权威逻辑；失败时 Reject 回滚，成功时复制权威结果，并通过 `ReplicatedPredictionKeyMap` 触发 CatchUp；客户端清理本地预测副作用，避免重复表现，最终接受服务端状态。

这几个角色的职责可以理解为:PredictionKey 标记了某个逻辑，`FScopedPredictionWindow` 负责给一段逻辑范围盖上 Key，Rejected Delegate 负责撤销，CaughtUp Delegate 负责追平。

关键代码:

- `FPredictionKey::CreateNewPredictionKey`
- `FPredictionKey::GenerateDependentPredictionKey`
- `FPredictionKey::NetSerialize`
- `FScopedPredictionWindow::FScopedPredictionWindow`
- `FScopedPredictionWindow::~FScopedPredictionWindow`
- `UAbilitySystemComponent::TryActivateAbility`
- `UAbilitySystemComponent::InternalTryActivateAbility`
- `UAbilitySystemComponent::InternalServerTryActivateAbility`
- `UAbilitySystemComponent::ClientActivateAbilityFailed_Implementation`
- `UAbilitySystemComponent::ApplyGameplayEffectSpecToSelf`
- `FActiveGameplayEffectsContainer::ApplyGameplayEffectSpec`
- `FActiveGameplayCue::PredictiveAdd`
