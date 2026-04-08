import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

// OpenClaw 也是这三种定时任务
export type JobType = "cron" | "every" | "at";

@Entity()
export class Job {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "text" })
  instruction: string;

  @Column({ type: "varchar", length: 10, default: "cron" })
  type: JobType;

  // cron 保存 cron 表达式
  @Column({ type: "varchar", length: 100, nullable: true })
  cron: string | null;

  // everyMs 保存时间间隔
  @Column({ type: "int", nullable: true })
  everyMs: number | null;

  // at 保存时间点
  @Column({ type: "timestamp", nullable: true })
  at: Date | null;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: "timestamp", nullable: true })
  lastRun: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
