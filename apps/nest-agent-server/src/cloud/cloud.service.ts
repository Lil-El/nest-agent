import { Injectable, Inject } from "@nestjs/common";
import RPCClient from "@alicloud/pop-core";
import { type AliCloudModuleOptions } from "./cloud.module";

@Injectable()
export class AliCloudService {
  @Inject("ALI_CLOUD_OPTIONS")
  private readonly options: AliCloudModuleOptions;

  private token: string;

  onModuleInit() {
    this.setToken();
  }

  async setToken() {
    const accessKeyId = await this.getAccessKeyId();
    const accessKeySecret = await this.getAccessKeySecret();

    const client = new RPCClient({
      accessKeyId,
      accessKeySecret,
      endpoint: "http://nls-meta.cn-shanghai.aliyuncs.com",
      apiVersion: "2019-02-28",
    });

    client
      .request("CreateToken", {})
      .then((result: any) => {
        this.token = result.Token.Id;
      })
      .catch((err) => {
        console.log(err);
      });
  }

  async getToken(): Promise<string> {
    return this.token;
  }

  async getAccessKeyId(): Promise<string> {
    return this.options.accessKeyId;
  }

  async getAccessKeySecret(): Promise<string> {
    return this.options.accessKeySecret;
  }

  async getEndPoint(): Promise<string> {
    return this.options.endPoint;
  }

  async getNlsKey(): Promise<string> {
    return this.options.nlsKey;
  }
}
