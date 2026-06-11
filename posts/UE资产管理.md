# UE资产管理（一）

这篇内容的思路会先从DT和DA这样的数据表讲起，在延申到AssetManager这个UE推荐的资产管理手段，同时穿插关于资产引用等相关的内容，会写的比较详细冗长，但尽可能解释清楚关于UE资产内容的许多设计和细节问题，也提醒自己能更好的关注到日常使用内容中背后的原理和实现。

# `DT` 和`DA`

一般项目常见的两个配置手段是`DataTable`和`DataAsset`，简称DT，DA，例如道具表、怪物表、关卡表等等。DT很适合做批量、结构化等的数据，用起来和表格差不多。DA则更像是一个配置对象一个资产，一般更适合做一个独立配置对象。

## `DataTable`

### 成员设计

一个典型的DT行数据定义可能是这样的

```cpp
USTRUCT()
struct FItemRow : public FTableRowBase
{
    GENERATED_BODY()

    UPROPERTY()
    int32 Id;

    UPROPERTY()
    FText Name;
};
```

`DataTable`可以看两个关键成员

```cpp
UCLASS(...)
class UDataTable
{
    UPROPERTY(VisibleAnywhere, Category=DataTable, meta=(DisplayThumbnail="false"))	
    TObjectPtr<UScriptStruct>   RowStruct;
protected:
	/** Map of name of row to row data structure. */
	TMap<FName, uint8*>		RowMap;
};
```

- `RowStruct`对应的就是`FItemRow`此用户自定义结构体的反射数据。描述了这行数据字段有哪些、类型是什么等等。
- `RowMap` 是行名到行数据内存的映射。

平时调用可能是这样的

```cpp
const FItemRow* Row = DataTable->FindRow<FItemRow>(RowName, TEXT("Find"));
```

这里本质用 `FName` 在 `RowMap` 里找到那行数据，再按 `FItemRow` 解释。

```cpp
template <class T>
T* FindRow(FName RowName,const TCHAR* ContextString,bool bWarnIfRowMissing = true) const
{

    //...

    uint8* const* RowDataPtr = GetRowMap().Find(RowName);
    if (RowDataPtr == nullptr)
    {
         return nullptr;
    }

    uint8* RowData = *RowDataPtr;
    check(RowData);

    return reinterpret_cast<T*>(RowData); // 转型
}
```

`uint8*` 在这里也就是表示”指向一块原始字节内存“。对应的是某一行自定义数据的内存地址

当此表格被加载时，会反序列化成`UDataTable`对象，这里`RowStruct`标注了`UPROPERTY`参与默认 UObject 序列化，但`RowMap` 因为是 `TMap<FName, uint8*>` 原始内存，不能靠默认反射系统自动处理，因此`UDataTable`会依赖`RowStruct`描述的结构体信息，把每一行数据恢复成对应结构体布局的内存，然后把行名和行数据地址都放进`RowMap`中，具体可以见`UDataTable::Serialize`

### `FDataTableRowHandle`

有时候我们可能会直接这样使用，RowType这个meta会影响怎么选`DataTable`

```cpp
USTRUCT(BlueprintType)
struct FItemSetting
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadOnly,meta = (RowType = "/script/Demo.ItemRow"))
    FDataTableRowHandle Config;
};
```

这个`FDataTableRowHandle` 指的就是某张表里的某一行。我们可以看它的类型结构

```cpp
USTRUCT(BlueprintType)
struct FDataTableRowHandle
{
    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    TObjectPtr<const UDataTable> DataTable; // 哪张表

    UPROPERTY(EditAnywhere, BlueprintReadWrite) 
    FName RowName; // 哪一行
};
```

有个小细节我们看到这里用的`TObjectPtr`是一个对象引用。如果某个资产确实硬引用了一个`RowHandle`，而`RowHandle`又直接引用了`DataTable`，那这张表就会被跟着加载。

## `RowName`

有时候会遇到一个问题，例如我们设计一张道具表的时候，到底是用`int32 Id`作为key还是用`DataTable`自带的`RowName`

可以看到如果对于`RowMap`来说，如果这张表服务给UE内部配置和资产选择，应该优先用`RowName`，因为不管是`RowHanel`、编辑器的行选择，或者是`FindRow`这样，都是围绕着`RowName`来工作的。

而如果外部系统强依赖数字ID，那就应该保留一个int Id的字段。但这里要确保做唯一性校验，规定它和`RowName`的关系。

### `FName\\FString\\FText`

再插入一个知识，`FName`\`FString`\`FText`都是表达字符串这个功能，为什么有这三个，为什么`DataTable`要用`FName`作为行名呢。

`FName`这个类前其实就有一段注释解释了

```cpp
/**
 * Public name, available to the world.  Names are stored as a combination of
 * an index into a table of unique strings and an instance number.
 * Names are case-insensitive, but case-preserving (when WITH_CASE_PRESERVING_NAME is 1)
 */
```

也就是说`FName`并非是字符串本身，而是全局名字表里的名字ID + 可选数字后缀。

```cpp
class FName
{
	FNameEntryId ComparisonIndex;
	uint32 Number;
	#if WITH_CASE_PRESERVING_NAME
	FNameEntryId DisplayIndex;
	#endif
}
```

例如我们有一组名字可能是，注意这里一定要用下划线 + 数字

```cpp
Actor
Actor_0
Actor_1
```

在`FName`里会被拆解成基础名字 + 数字后缀的形式，也就是说，`ComparisonIndex`指向的全局名字表中的”Actor”，`Number`则是存储这个数字后缀（但是这里有个Number == 0 表示的是没有后缀，所以Actor_0的Number应该是1,得往后加一位）

因此，相比较`FString`，`FName`可以通过`ComparisonIndex` 和`Number` 加速查询过程，大量的`FName` 都会进入到全局名字库，所以某种情况下说，许多表的`RowName`都是1，2，3这样纯数字，反而某种情况下会减少全局名字库的数量。但是相比较这些可控的名字来说，尽管这些是名字是常驻内存中的，一般也不太可能成为内存问题，更良好的名字用于配置和展示才应该是考虑范围。除非你可能动态生成大量不一的`FName`，那就要小心了。这样其实也可以理解为什么DataTable使用FName作为行名，从语义上它确实指代这一行，另一方面这也确实可以加速查询。

至于`FString`和一般认知意义上的字符类型是差不多的，而`FText`则更重一些，它是面向玩家显示的文本，支持本地化，不再赘述了。

现在思考一个问题，如果某张DT表的有几万个字段，每行数据里可能引用了很多内容，而一旦要加载进内存中，就是整张表都要Load进来。一般这里都会认为不要写硬引用，而使用软引用，这样不要再加载时把一系列的资源都一口加载进来。我们之后再讨论关于加载、同步加载和异步加载的问题。

## DataAsset

对于DA表格，可能是这样写的，项目里可以创建多份`UItemDataAsset`的资产，每一份都是独立配置。

```c++
UCLASS(BlueprintType)
class UItemDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    FName ItemId;

    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    FText DisplayName;

    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    TSoftObjectPtr<UTexture2D> Icon;
};
```

UDataAsset本身也非常简单，只是一个很轻量的可资产化的UObject积累。

```c++
UCLASS(abstract, MinimalAPI, Meta = (LoadBehavior = "LazyOnDemand"))
class UDataAsset : public UObject
{
	GENERATED_UCLASS_BODY()
public:
	// UObject interface
#if WITH_EDITORONLY_DATA
	ENGINE_API virtual void Serialize(FStructuredArchiveRecord Record) override;
#endif

private:
	UPROPERTY(AssetRegistrySearchable)
	TSubclassOf<UDataAsset> NativeClass;
};
```

`NativeClass` 保存这个 DataAsset 对应的原生 C++ 类型信息,也就是“某个继承自 UDataAsset 的类”。

## UPrimaryDataAsset  

UPrimaryDataAsset 继承自UDataAsset，是一个非常重要的派生类。这里引擎也留下了一大段注释来解释

* 实现了`GetPrimaryAssetId`，支持`AssetBunch`，可以被`AssetManager`手动加卸载
* Native继承和蓝图继承的一些规则，包括重点解释了`PrimaryAssetType`的推导规则，这里Native可以认为说的就是C++继承链的意思。

简单来说，`PrimaryAssetType` 是理解为资产分类，代表的是一类资产。`PrimaryAssetId` 是则是某个 Primary Asset 的唯一身份标识。

```C++
USTRUCT(BlueprintType)
struct FPrimaryAssetType
{
private:
    FName Name;
}

USTRUCT(BlueprintType)
struct FPrimaryAssetId
{
    FPrimaryAssetType PrimaryAssetType;
    FName PrimaryAssetName;
}

```

假如我们有一个UItemDefinition继承自UPrimaryDataAsset ，并创建了一个DA资产叫DA_Item_Sword，那么这里FPrimaryAssetType就是这个`UItemDefinition`，`PrimaryAssetName`就是DA_Item_Sword，而FPrimaryAssetId则是UItemDefinition:DA_Item_Sword这样的形式，标识了这个唯一的资产。

对于`PrimaryAssetType`的推导规则，总结一下也非常简单，从当前的资产类向父类往上找：

* 如果是原生的C++继承链（Native Class），取离资产最近的那个native类名
* 如果是蓝图继承链，取最高层的蓝图类名



很好看出，区别于普通的DataAsset只是一个UObject资产，`UPrimaryDataAsset` 更多是为了配合`AssetManager`管理`PrimaryAsset`进行设计的。



# AssetManager

