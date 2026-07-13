---
date: 2026-06-28
tags:
  - "Note"
---

# 智能指针

重新看《Effective Modern C++》过程中，又有了一些新的理解，所以说经典书籍还是得常看常新。因此也对UE自己实现的智能指针有了这么几个疑惑。

1. 自定义析构器的设计如何呢
2. UE版本的奇妙递归模板使用方式
4. UE是否也有使用make系列函数，但因为weak_ptr计数未归零时，没有把控制块内存回收的特性

## 自定义析构函数

std版本的自定义析构器如下

```c++
// 函数对象写法：手写 struct，并重载 operator()
struct StructDeleter
{
    void operator()(Widget* Ptr) const
    {
        std::cout << "structDeleter custom deleter\n";
        delete Ptr;
    }
};

// 函数对象写法：lambda 表达式，编译器会生成匿名函数对象类型
auto LambdaDeleter = [](Widget* Ptr)
{
    std::cout << "lambdaDeleter custom deleter\n";
    delete Ptr;
}

// 函数指针写法：普通函数
void FuncDeleter(Widget* ptr)
{
    std::cout << "funcDeleter custom deleter\n";
    delete Ptr;
}

{
    std::unique_ptr<Widget, StructDeleter> UniquePtr(new Widget(1));
    std::shared_ptr<Widget> SharedPtr(new Widget(2), StructDeleter{});
    
    std::unique_ptr<Widget, decltype(LambdaDeleter)> UniquePtr(new Widget(3), LambdaDeleter);
    std::shared_ptr<Widget> SharedPtr(new Widget(4), LambdaDeleter);
    
    std::unique_ptr<Widget, void (*)(Widget*)> UniquePtr(new Widget(5), FuncDeleter);
    std::shared_ptr<Widget> SharedPtr(new Widget(6), FuncDeleter);
   
}

```

UE版本的有一些不同。

`TUniquePtr`不接受函数指针写法，Deleter需要是可继承类型，但是`TSharedPtr`可以这样写

```c++
 TSharedPtr<FWidget> SharedPtr = MakeShareable(new FWidget(6), &FuncDeleter);
```

`TSharedPtr`从裸指针创建并传自定义 deleter 时，需要用 `MakeShareable`。TSharedPtr 使用 `MakeShareable` 传 lambda deleter 时，具名 lambda 左值推导会导致编译不过，应使用 MoveTemp，或者直接传 lambda 右值。

```c++
TUniquePtr<FWidget, decltype(LambdaDeleter)> UniquePtr(new FWidget(3), LambdaDeleter);

TSharedPtr<FWidget> SharedPtr = 
    MakeShareable(new FWidget(4), MoveTemp(LambdaDeleter));

// or
TSharedPtr<FWidget> SharedPtr =
    MakeShareable(new FWidget(4), [](FWidget* Ptr)
    {
        UE_LOG(LogTemp, Display, TEXT("Shared lambda custom deleter"));
        delete Ptr;
    });

```

## 奇妙递归模板（CRTP）

对象内部如何拿到自己的shared_ptr，直接用this指针包装很危险，会创建一个新的控制块，因此需要借助到奇妙递归模板。std的版本如下
```c++
class Widget : public std::enable_shared_from_this<Widget>
{
public:
    std::shared_ptr<Widget> GetSelf()
    {
        return shared_from_this();
    }
}

auto Obj = std::make_shared<Widget>();
std::shared_ptr<Widget> Self = Obj->GetSelf();

```
在UE里的类似版本如下，没什么区别，都是既然对象已经由智能指针管理，则允许对象从this安全拿回自己的智能指针。
```c++
class FWidget : public TSharedFromThis<FWidget>
{
public:
    void Test()
    {
        TSharedRef<FWidget> self = AsShared();
    }
}
```
```c++
void RegisterTo(FManager& Manager)
{
    Manager.Add(AsShared());
}
```
##  内存分配问题

```c++
std版创建share_ptr写法
auto Ptr = std::shared_ptr<Widget>(new Foo()); // 两次分配，两块内存：new Foo() 、shared_ptr分配
auto Ptr = std::make_shared<Widget>(); // 更推荐的写法，只进行一次分配，控制块 + 对象都在一块allocation中
```
问题在于，如果有weak_ptr计数尚未释放，还需要控制块来判断对象是否过期，第二种make_shared<T>的写法，会导致即使Widget已经析构了，整块内存依然还不能还给分配器，直到WeakPtr的计数也清零。

那么UE的智能指针有没有这个问题呢？
```c++
MakeShareable(new T) // 对象和引用控制块通常分开分配
MakeShared<T>()      // 对象 + 引用控制块通常在同一块内存里
```
答案是也有，上面两种写法就对应了std版本的，UE自己的文档里也提到了这一点
```c++
There are two heap allocations for reference controllers. Using MakeShared instead of MakeShareable avoids the second allocation, and can improve performance.
```
默认场景下还是推荐使用MakeShared，能少一次内存分配。
