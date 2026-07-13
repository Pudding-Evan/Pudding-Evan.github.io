---
date: 2026-05-31
tags:
  - "GAS"
summary: "GameplayAbility 与 GameplayTag"
order: 4
---

# GAS设计解析四：GA与GameplayTag

GameplayAbility是真正承载“技能业务流程”的对象。如果说 ASC 是技能系统的中枢，Attribute 是被修改的数据，GameplayEffect 是对 ASC 产生影响的数据化效果，那么 GameplayAbility 就是“什么时候检查、什么时候启动、什么时候播放动作、什么时候提交消耗、什么时候应用 GE、什么时候等待输入、什么时候结束”的业务载体。例如，一个火球术通常是一段 Ability 流程：检查蓝量和冷却，播放施法动画，等待命中或目标数据，然后对目标应用伤害 GE，再应用自身冷却 GE，最后结束 Ability。GE 只是这条流程中被应用出去的效果。

GameplayTag 在这套技能流程里大量使用，不管是GA、GE都绕不开它。GAS 的很多判断不会写成 `bIsStunned`、`bIsDead`、`bCanCastFireball` 这类布尔变量，一定是通过 `State.Stunned`、`State.Dead`、`Ability.Fireball`、`Cooldown.Fireball` 这样的层级标签表达。Tag 的价值在于，它把许多分散的状态和条件变成一套可组合、可查询、可配置的树结构状态，非常强大灵活。

## Ability 负责什么

Epic 官方文档对 GameplayAbility 的定义是：`UGameplayAbility` 定义一个游戏内能力做什么、使用它需要什么成本、在什么条件下可以使用。它可以异步执行，可以用 AbilityTask 处理动画、粒子、声音、玩家输入和交互，也可以根据网络策略运行在客户端或服务端。

放到项目语境里，Ability 通常负责这几类工作：

1. 检查这个技能现在能不能用，例如是否死亡、是否被眩晕、冷却是否结束、资源是否足够。
2. 响应输入、事件或代码触发，启动技能流程。
3. 组织技能执行过程，例如播放 Montage、等待目标数据、监听输入释放、生成投射物。
4. 在合适时机提交 Cost 和 Cooldown。
5. 对自己或目标应用 GameplayEffect。
6. 触发 GameplayCue 或项目自己的表现逻辑。
7. 在成功、取消、失败、被打断时收尾。

这里要注意 Ability 和 GE 的边界。Ability 是流程，GE 是效果。Ability 可以应用多个 GE，也可以不应用 GE；GE 可以由 Ability 应用，也可以其他GE触发等来应用。要明确：Ability 不应该把属性系统重新写一遍，GE 不应该承担技能流程调度。

举个例子：一个普通攻击 Ability，可以负责输入、连段窗口、动画事件、命中检测；真正造成伤害时应用一个 Damage GE。一个治疗 Ability，可以负责选目标、施法时间、打断逻辑；真正恢复生命时应用 Heal GE。一个被动 Ability，可以在被授予后监听某类事件；当事件发生时应用对应 GE 或触发额外流程。

## Ability 如何进入 ASC

Ability 需要先被授予给 ASC，进入 `ActivatableAbilities` 之后，才有资格被激活。

```cpp
FGameplayAbilitySpecHandle UAbilitySystemComponent::GiveAbility(const FGameplayAbilitySpec& Spec)
{
	if (!IsOwnerActorAuthoritative())
	{
		return FGameplayAbilitySpecHandle();
	}

	FGameplayAbilitySpec& OwnedSpec =
		ActivatableAbilities.Items[ActivatableAbilities.Items.Add(Spec)];

	if (OwnedSpec.Ability->GetInstancingPolicy() == InstancedPerActor)
	{
		CreateNewInstanceOfAbility(OwnedSpec, Spec.Ability);
	}

	OnGiveAbility(OwnedSpec);
	MarkAbilitySpecDirty(OwnedSpec, true);
	return OwnedSpec.Handle;
}
```

* `GiveAbility` 只能由 OwnerActor 的权威端调用。普通客户端不能随便给自己添加 Ability。

* ASC 不保存 `UGameplayAbility` ，它保存的是 `FGameplayAbilitySpec`。Spec 里保存 Ability 类、等级、InputID、SourceObject、Handle、动态 AbilityTags、当前激活信息等运行时数据。你可以理解为Ability 类是能力模板，把AbilitySpec 则是“某个 ASC 拥有这个能力”的运行时记录。

一个 Ability 也可以通过 GE 授予。上一篇提到过，GE 激活期间可以授予 Ability，GE 被移除时 Ability 也会跟着撤销。这适合装备技能、状态技能、临时被动。比如装备一把枪后，一个 Infinite GE 授予 `GA_WeaponFire`；卸下武器时移除 GE，开火 Ability 自然消失。

## Ability 的激活路径

Ability 的激活通常从 ASC 开始：

```cpp
bool UAbilitySystemComponent::TryActivateAbility(FGameplayAbilitySpecHandle AbilityToActivate,
                                                 bool bAllowRemoteActivation)
```

`TryActivateAbility` 会先找到 Spec，确认 OwnerActor 和 AvatarActor 有效，确认当前不是 SimulatedProxy，然后根据 Ability 的网络策略决定是在本地执行、请求服务端执行，还是直接失败。通过这些初步判断之后，才进入 `InternalTryActivateAbility`。

源码中对 `InternalTryActivateAbility` 的注释如下：

```cpp
/**
 * Attempts to activate the ability.
 *	-This function calls CanActivateAbility
 *	-This function handles instancing
 *	-This function handles networking and prediction
 *	-If all goes well, CallActivateAbility is called next.
 */
```

展开来看，它会做几件事。

1. 先根据 Handle 找到 `AbilitySpec`，再检查 `ActorInfo`、网络角色和 Ability 的 `NetExecutionPolicy`。
2. 然后选择 Ability 实例：如果是 `InstancedPerActor`，使用已有实例；如果是 `InstancedPerExecution`，激活时创建新实例；如果是 `NonInstanced`，则直接使用 CDO。
3. 接着调用 `CanActivateAbility` 做条件检查。如果检查通过，才会创建 `FGameplayAbilityActivationInfo`，处理预测窗口，最后调用 `CallActivateAbility`。

`CallActivateAbility` 本身很短：

```cpp
void UGameplayAbility::CallActivateAbility(...)
{
	PreActivate(...);
	ActivateAbility(...);
}
```

* `PreActivate` 会把 `ActivationOwnedTags` 加到 ASC 上，通知 ASC Ability 已激活，应用 `BlockAbilitiesWithTag` 和 `CancelAbilitiesWithTag`，然后增加 Spec 的 `ActiveCount`。

* `ActivateAbility` 是实际的业务内容执行的地方。蓝图里对应的是 `Activate Ability` 事件，C++ 中覆写 `UGameplayAbility::ActivateAbility`。官方文档也强调，GameplayAbility 不像 Actor 或 Component 基本不会靠Tick来执行业务逻辑。更常见的写法是启动一组 AbilityTask，让任务在动画结束、输入释放、目标数据返回、GameplayEvent 到提供回调函数，然后在回调中继续流程，换句话说，也就是更多依靠事件触发逻辑。

## CanActivate 与 Commit

Ability 激活前会调用 `CanActivateAbility`。：

```cpp
if (!CheckCooldown(...))
{
	return false;
}

if (!CheckCost(...))
{
	return false;
}

if (!DoesAbilitySatisfyTagRequirements(...))
{
	return false;
}

if (AbilitySystemComponent->IsAbilityInputBlocked(Spec->InputID))
{
	return false;
}

if (K2_CanActivateAbility(...) == false)
{
	return false;
}
```

Ability 能不能启动，至少要过冷却、消耗、Tag 条件、输入阻塞和项目自定义条件几关。消耗和冷却通常发生在 `CommitAbility`：

```cpp
bool UGameplayAbility::CommitAbility(...)
{
	if (!CommitCheck(...))
	{
		return false;
	}

	CommitExecute(...);
	K2_CommitExecute();
	NotifyAbilityCommit(this);
	return true;
}
```

`CommitCheck` 会再次检查 Cost 和 Cooldown。源码注释解释了这个设计：一个 Ability 可能先播放动画，等待玩家确认目标，然后才真正消耗资源。开始激活时资源足够，不代表几百毫秒之后仍然足够。Commit 是最后一次确认，也是实际写入 Cost/Cooldown 的位置。

默认 `CommitExecute` 做两件事：

```cpp
ApplyCooldown(...);
ApplyCost(...);
```

`ApplyCooldown` 会把 Cooldown GE 应用到 Owner ASC。Cooldown GE 通常是 Duration GE，并授予 `Cooldown.X` 这样的 Tag。`CheckCooldown` 则通过检查 ASC 是否拥有这些 Cooldown Tag 来决定技能是否还在冷却中。

`ApplyCost` 会应用 Cost GE。`CheckCost` 则会调用 ASC 的 `CanApplyAttributeModifiers`，先模拟检查 Cost GE 的 Attribute Modifier 是否能应用。典型 Mana Cost 就是一个 Instant GE，把 Mana 减掉。如果减完会违反属性限制，检查就会失败。

这也是GA和GE的功能分界。Ability 自己不直接扣 Mana，也不直接设置 Cooldown 计时器。它通过 Cost GE 和 Cooldown GE 把这两个动作交回 GE系统。

## Ability 网络策略

技能执行在服务端还是客户端，主要看 `NetExecutionPolicy`。`UGameplayAbility` 里有四种常见策略：

- `LocalOnly`
- `LocalPredicted`
- `ServerOnly`
- `ServerInitiated`

`LocalOnly` 只在本地运行。它适合纯本地表现、UI 或不需要服务端认可的流程。服务端不会执行这段能力逻辑。

`ServerOnly` 只在服务端运行。客户端尝试激活时，会发送 RPC 请求服务端执行；客户端本地不预测执行。它适合必须完全由服务端裁决的能力。

`LocalPredicted` 是玩家技能里最常见的一类。客户端先本地执行，生成 PredictionKey，然后通过 RPC 请求服务端执行同一 Ability。服务端接受后复制结果回来，客户端追平；服务端拒绝则客户端回滚。

`ServerInitiated` 由服务端发起，但可以通知拥有者客户端执行对应流程。它更适合服务端决定某个能力开始，然后客户端跟随表现。

源码里 `TryActivateAbility` 对这些策略做了分流。非本地端不能直接激活 `LocalOnly` 或没有预测 Key 的 `LocalPredicted`。非权威端不能直接执行 `ServerOnly` 或 `ServerInitiated`，只能请求服务端。到了 `InternalTryActivateAbility`，`LocalPredicted` 分支会创建预测窗口，设置 ActivationInfo 为 Predicting，然后立刻调用 Server RPC，并在本地继续执行 `CallActivateAbility`。

## Ability 实例策略

* `NonInstanced` 表示不创建实例，执行时使用 CDO。它开销低，但不能保存每次激活的状态，也不适合依赖异步任务和实例变量的复杂技能。

* `InstancedPerActor` 表示每个 ASC 拥有一个 Ability 实例。这个实例可以保存状态，可以绑定委托，可以运行异步任务。大多数需要蓝图逻辑、AbilityTask 或持续状态的技能都会选择它。如果它已经激活，再次激活要看 `bRetriggerInstancedAbility` 是否允许重触发。

* `InstancedPerExecution` 表示每次激活创建一个新实例。它适合每次激活之间需要完全隔离状态的能力，但在预测和复制上约束更多。

## AbilityTask

GameplayAbility 异步执行主要依赖 AbilityTask。最常用的，例如等待 Montage 结束、等待输入释放、等待 GameplayEvent、等待目标数据、等待 GameplayTag 变化等。

## GameplayTag

GameplayTag 是一套层级标签系统。Epic 官方文档中给的定义是：Gameplay Tags 是用户定义的字符串，作为概念性、层级化标签，可以应用到项目对象上，并用来驱动玩法逻辑。

例如：

```text
State.Dead
State.Stunned
Ability.Fireball
Cooldown.Fireball
GameplayCue.Fire.Burn
Event.Movement.Dash
Data.Damage
```

Tag 用 `.` 分层。`State.Stunned.Heavy` 天然属于 `State.Stunned`，也属于 `State`。`HasTag` 会考虑父子层级，`HasTagExact` 才要求完全匹配。引擎测试里也有对应行为：拥有 `Effect.Damage.Fire` 时，`HasTag(Effect.Damage)` 为真，但 `HasTagExact(Effect.Damage)` 为假。

这让 Tag 比枚举更适合表达可扩展的玩法分类。枚举通常是封闭集合，新增类型要改代码；Tag 是项目级字典，可以由配置、资产、数据表和 C++ 原生定义共同维护。

## Tag 在 GAS 中的几类角色

Tag 在 GAS 里至少有五类常见角色。

第一类是状态标签。GE 可以在激活期间给 ASC 授予 Tag，例如 `State.Stunned`、`State.Invincible`、`State.Burning`。Ability 可以通过 ActivationRequiredTags 和 ActivationBlockedTags 检查这些状态，决定自己能不能激活。

第二类是能力标签。Ability 自身有 AssetTags，也就是过去常说的 AbilityTags，例如 `Ability.Fireball`、`Ability.Melee.LightAttack`。这些标签可以被 ASC 用来查找、激活、取消或阻塞能力。比如调用 `TryActivateAbilitiesByTag` 激活一类 Ability，或者用 `CancelAbilitiesWithTag` 取消一组 Ability。

第三类是冷却标签。Cooldown GE 一般会授予 `Cooldown.X`。`CheckCooldown` 不是查询某个计时器，而是检查 ASC 是否拥有 Cooldown GE 授予的 Tag。这样一个技能的冷却状态可以被 UI、输入、Ability 检查共享。

第四类是事件标签。GameplayEvent 使用 Tag 表达事件类型，例如 `Event.Ability.ComboWindow`、`Event.Projectile.Hit`。Ability 可以由 GameplayEvent 触发，也可以在 AbilityTask 中等待某类事件。

第五类是数据标签。SetByCaller 常用 Tag 作为 Key，例如 `Data.Damage`、`Data.ChargeTime`。这个 Tag 不代表状态，而是代表 Spec 中某个运行时数值的语义。

## Ability 中的 Tag 检查

`UGameplayAbility::DoesAbilitySatisfyTagRequirements` 是理解 Ability Tag 进行门控判断的关键函数。我们看到GA里通常可以配置一系列的Tag，命名有时候非常迷惑，依赖源码或者是实际的业务才能真的弄清楚是干什么用的，非常不友好。通常游戏项目都会尝试自己写一套上层的框架覆盖掉它，而不是直接来改，因为真的太难用了。

源码核心逻辑可以简化为：

```cpp
CheckForBlocked(GetAssetTags(), AbilitySystemComponent.GetBlockedAbilityTags());
CheckForBlocked(AbilitySystemComponent.GetOwnedGameplayTags(), ActivationBlockedTags);
CheckForBlocked(*SourceTags, SourceBlockedTags);
CheckForBlocked(*TargetTags, TargetBlockedTags);

CheckForRequired(AbilitySystemComponent.GetOwnedGameplayTags(), ActivationRequiredTags);
CheckForRequired(*SourceTags, SourceRequiredTags);
CheckForRequired(*TargetTags, TargetRequiredTags);

if (!bBlocked && !bMissing)
{
	bBlocked = AbilitySystemComponent.AreAbilityTagsBlocked(GetAssetTags());
}
```

* Ability 可以声明自己被哪些状态阻挡。例如 `ActivationBlockedTags` 包含 `State.Stunned`，那么 ASC 拥有这个状态时，Ability 不能激活。

* Ability 可以声明自己需要哪些状态。例如某个终结技要求目标有 `State.Weakened`，或者某个二段技能要求自身有 `State.Combo.Window`。

* ASC 可以从外部阻塞一类 Ability。`ApplyAbilityBlockAndCancelTags` 会在 Ability 激活时调用 `BlockAbilitiesWithTags` 和 `CancelAbilities`。比如翻滚 Ability 激活期间，可以阻塞 `Ability.Attack`，并取消带 `Ability.Cast` 标签的施法 Ability。

## Tag 和 GE 的关系

GE 中的 Tag 更多表达为“效果应用和效果存在期间的规则”。

例如一个眩晕 GE 会授予 `State.Stunned`。所有需要禁止的 Ability 都可以把 `State.Stunned` 放进 `ActivationBlockedTags`。这样眩晕系统不需要知道项目里有多少个技能，技能也不需要知道眩晕 GE 是哪一个资产。二者只通过 Tag 对话。

再比如火球 Ability 成功 Commit 后应用 Cooldown GE，Cooldown GE 授予 `Cooldown.Fireball`。火球 Ability 的 `GetCooldownTags` 返回同一个 Tag。下次 `CheckCooldown` 时，如果 ASC 仍有 `Cooldown.Fireball`，Ability 就不能激活。

再比如一个 Buff GE 授予 `State.Empowered.Fire`。火系 Ability 可以把这个 Tag 作为 RequiredTag，或者在 MMC/Execution 中通过 SourceTags 检查它，从而增强伤害。

Tag 是 GAS 中最重要的解耦手段之一。Ability 不必持有 GE 引用，GE 不必知道所有 Ability，UI 不必知道每个技能内部条件。但大家都查同一套 Tag，其实一定程度上，你可以理解为Tag是字典状态集合。

## 一条技能从输入到效果的完整例子

假设我们做一个蓄力火球 `GA_Fireball`。它的 AbilityTags 是 `Ability.Fire.Fireball`，ActivationBlockedTags 包含 `State.Dead`、`State.Stunned`，Cooldown GE 授予 `Cooldown.Fireball`，Cost GE 消耗 Mana。

玩家按下输入后，ASC 找到对应 AbilitySpec，调用 `TryActivateAbility`。如果这是 `LocalPredicted` Ability，客户端会先打开预测窗口，生成 PredictionKey，然后立刻本地执行，同时把激活请求发给服务端。`CanActivateAbility` 会检查 Avatar 是否有效、当前是否冷却、Mana 是否足够、ASC 是否有阻塞 Tag、输入是否被阻塞。

检查通过后进入 `CallActivateAbility`。`PreActivate` 会授予 `ActivationOwnedTags`，应用 Ability 配置中的 Block/Cancel Tags。`ActivateAbility` 中启动播放 Montage 的 AbilityTask，并等待输入释放。玩家松手时，Ability 根据蓄力时间把 `Data.ChargeTime` 写入 Damage GE 的 Spec，然后把 Damage GE 应用到目标 ASC。接着调用 `CommitAbility`，应用 Cost GE 和 Cooldown GE。Cooldown GE 授予 `Cooldown.Fireball`，所以下一次再按技能时 `CheckCooldown` 会失败。最后 Ability 调用 `EndAbility`，移除激活期间的临时状态，解除 Block Tags，整个流程结束。

这条线里，Ability 负责流程，GE 负责效果，Attribute 承接数值变化，Tag 负责门控和状态表达，ASC 负责把它们放在同一张桌子上协调。理解这条线，GAS 的整体形状会清楚很多。



## 总结

GameplayAbility 是 GAS 的业务流程载体。GameplayEffect 是 Ability 常用的结果表达，但不是 Ability 本身。Attribute 负责承载数值，ASC 负责集中管理，GameplayTag 负责把状态、能力分类、冷却、事件和运行时数据的统一语言，给与其他模块修改查询。

下一篇的预测机制会直接建立在 Ability 的网络策略、PredictionKey 和 GE/Cue 副作用之上。先理解 Ability 如何启动和提交，再看预测回滚，会少很多跳变。

可以关注以下源码内容：

- `UAbilitySystemComponent::GiveAbility`
- `UAbilitySystemComponent::TryActivateAbility`
- `UAbilitySystemComponent::InternalTryActivateAbility`
- `UGameplayAbility::CanActivateAbility`
- `UGameplayAbility::DoesAbilitySatisfyTagRequirements`
- `UGameplayAbility::CallActivateAbility`
- `UGameplayAbility::CommitAbility`
- `UGameplayAbility::CheckCooldown`
- `UGameplayAbility::ApplyCooldown`
- `UGameplayAbility::CheckCost`
- `UGameplayAbility::ApplyCost`
- `UAbilitySystemComponent::ApplyAbilityBlockAndCancelTags`
