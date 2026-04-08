# Nest

> 项目仅用作个人测试，package.json 中可以不使用 scope
> .env 文件内容在语雀中查看

## 架构

MVC 架构：

在 controller 里面写路由，比如 /list 的 get 接口，/create 的 post 接口。

在 service 里写具体的业务逻辑，比如增删改查、调用第三方服务等

这些都是以 module 的形式组织，一个 module 里有 controller、service 等

## 命令

```bash
  nest g module book --no-spec

  nest g res book --no-spec
```

1. `nest g module` 只创建的是 module

2. `nest g res` 创建的是 resource，包含完整的 RESTful 资源模块（模块 + 控制器 + 服务 + DTOs + 实体）

## 模块

- 1. book：nest 基础使用
- 2. ai: sse 流式返回AI响应
- 3. ai2: sse 流式返回AI响应
  - web 搜索、邮件发送、数据库操作、定时任务
  - job: 定时任务
- 4. nls: Natural Language Speech 自然语言语音

### Nest

1.`controller` 调用 `service`

> 一个controller需要使用两个service时，是在一个service中调用另一个service呢，还是在controller中调用两个service呢

简单场景：Controller 调用多个 Service

复杂业务逻辑：创建专门的协调 Service

2.模块引用

**在 cron 中使用 book**

> app.module 中导入了 cron 和 book 等许多 module，是为了创建路由以及全局的配置；
> 但是 每个模块之间 是相互隔离的；

- 在 `book.module` 中导出 `export book.service`
- 在 `cron` 中使用 `bookService` 时，需要在 `cron.module` 中导入 `book.module`
  - `@Inject(BookService)`

或者

- 在 `book.module` 中不导出 `export book.service`
- 在 `cron.module` 中直接提供 `provide book.service`

3.动态模块

**创建动态模块 `cloud`**

`cloud.module.ts` 中返回的模块，会替代 `@Module({})` 的模块；

**global**

当动态模块设置为 `global:true` 时，其他模块可以直接引入模块的 `provider`: `@Inject(AliCloudService)`

如果没有设置 `global:true`，则其他模块需要 `import` 动态模块时，`imports:[AliCloudModule]` 导入的只是一个类，需要在这里加入配置才可以使用：`imports:[AliCloudModule.forRoot({...})]`

## Cron 表达式

Cron表达式是一种用于定义定时任务执行时间的字符串格式
