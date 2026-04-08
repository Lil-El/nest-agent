# Nest

> 项目仅用作个人测试，package.json 中可以不使用 scope

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
- 3. cron: web 搜索、邮件发送、数据库操作、定时任务
  - 4. job: 定时任务

### 模块引用

**在 cron 中使用 book**

> app.module 中导入了 cron 和 book module，但是 cron 和 book 直接是相互隔离的

- 在 `book.module` 中导出 `export book.service`
- 在 `cron` 中使用 `bookService` 时，需要在 `cron.module` 中导入 `book.module`
  - `@Inject(BookService)`

或者

- 在 `book.module` 中不导出 `export book.service`
- 在 `cron.module` 中直接提供 `provide book.service`

## Cron 表达式

Cron表达式是一种用于定义定时任务执行时间的字符串格式
