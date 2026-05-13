# Neo4j

Neo4j 是一个开源的图数据库，用于处理关系数据。

## Neo4j Cypher 语句实战

### 一、创建实体（节点）

#### 1. 创建奶茶品类

```
CREATE (product:Product {name: "珍珠奶茶"})
CREATE (type1:Type {name: "台式奶茶"})
CREATE (type2:Type {name: "港式奶茶"})
```

#### 2. 创建配料

```
CREATE (ing1:Ingredient {name: "珍珠"})
CREATE (ing2:Ingredient {name: "芋圆"})
CREATE (ing3:Ingredient {name: "果糖"})
CREATE (ing4:Ingredient {name: "红茶"})
CREATE (ing5:Ingredient {name: "牛奶"})
```

#### 3. 创建制作工艺 & 适用人群

```
CREATE (method1:Method {name: "煮制"})
CREATE (method2:Method {name: "冲泡"})

CREATE (people1:People {name: "年轻人"})
CREATE (people2:People {name: "学生"})
CREATE (people3:People {name: "甜食爱好者"})
```

### 二、创建关系（知识图谱核心）

```
// 珍珠奶茶 属于 台式奶茶
MATCH (p:Product {name: "珍珠奶茶"}), (t:Type {name: "台式奶茶"})
CREATE (p)-[:属于]->(t)

// 珍珠奶茶 包含 配料
MATCH (p:Product {name: "珍珠奶茶"}), (i:Ingredient {name: "珍珠"})
CREATE (p)-[:包含]->(i)

MATCH (p:Product {name: "珍珠奶茶"}), (i:Ingredient {name: "果糖"})
CREATE (p)-[:包含]->(i)

MATCH (p:Product {name: "珍珠奶茶"}), (i:Ingredient {name: "红茶"})
CREATE (p)-[:包含]->(i)

MATCH (p:Product {name: "珍珠奶茶"}), (i:Ingredient {name: "牛奶"})
CREATE (p)-[:包含]->(i)

// 配料 使用 制作工艺
MATCH (i:Ingredient {name: "珍珠"}), (m:Method {name: "煮制"})
CREATE (i)-[:使用]->(m)

// 珍珠奶茶 适合 人群
MATCH (p:Product {name: "珍珠奶茶"}), (peo:People {name: "年轻人"})
CREATE (p)-[:适合]->(peo)

MATCH (p:Product {name: "珍珠奶茶"}), (peo:People {name: "学生"})
CREATE (p)-[:适合]->(peo)

MATCH (p:Product {name: "珍珠奶茶"}), (peo:People {name: "甜食爱好者"})
CREATE (p)-[:适合]->(peo)
```

### 三、查询验证

#### 1. 查询全部节点与关系

```
MATCH (n)-[r]->(m)
RETURN n, r, m
```

#### 2. 多跳关联查询（GraphRAG 能力）

```
// 查询：珍珠奶茶 → 配料 → 制作工艺
MATCH (p:Product {name: "珍珠奶茶"})-[:包含]->(i)-[:使用]->(m)
RETURN p.name, i.name, m.name

// 查询：珍珠奶茶适合哪些人
MATCH (p:Product {name: "珍珠奶茶"})-[:适合]->(people)
RETURN p.name, people.name
```


### 更新/删除

```
1. 更新：给珍珠奶茶加热量属性
MATCH (p:Product {name:"珍珠奶茶"})
SET p.calorie = "中高热量", p.taste = "甜香"

2. 更新：修改珍珠工艺属性
MATCH (i:Ingredient {name:"珍珠"})
SET i.origin = "台湾", i.hard = "Q 弹"

3. 只删除某一条关系
// 删除 珍珠奶茶 适合 学生 这条关系
MATCH (p:Product {name:"珍珠奶茶"})-[r: 适合]->(s:People {name:"学生"})
DELETE r

4. 删除单个节点（无关联才可删）
MATCH (t:Type {name:"港式奶茶"})
DELETE t

5. 删除节点 + 连带所有关系
MATCH (i:Ingredient {name:"芋圆"})-[r]-()
DELETE r, i

6. 清空所有节点和关系（本地测试用）
MATCH (n)
DELETE n
```