import { Injectable } from "@nestjs/common";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
};

@Injectable()
export class MockUserService {
  private readonly users = new Map<string, User>([
    ["001", { id: "001", name: "赵云", email: "zhaoyun@example.com", role: "admin" }],
    ["002", { id: "002", name: "诸葛亮", email: "zhugeliang@example.com", role: "manager" }],
    ["003", { id: "003", name: "关羽", email: "guanyu@example.com", role: "user" }],
    ["004", { id: "004", name: "张飞", email: "zhangfei@example.com", role: "user" }],
    ["005", { id: "005", name: "刘备", email: "liubei@example.com", role: "owner" }],
    ["006", { id: "006", name: "黄忠", email: "huangzhong@example.com", role: "user" }],
  ]);

  create(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  update(id: User["id"], user: Partial<Omit<User, "id">>): User | undefined {
    const oldUser = this.users.get(id);
    if (!oldUser) return undefined;

    this.users.set(id, { ...oldUser, ...user });
    return this.users.get(id);
  }

  delete(id: User["id"]): boolean {
    return this.users.delete(id);
  }

  findAll(): User[] {
    return Array.from(this.users.values());
  }

  findOne(id: User["id"]): User | undefined {
    return this.users.get(id);
  }
}
