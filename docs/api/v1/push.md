# 服务端推送

Core 将新通知发送到启用的 NTFY、BARK 或 MACOS_NOTIFICATION 目标，独立于主模型运行。DISPATCHED/dispatched_at 表示渠道接口接受请求；客户端展示与已读另行上报。实现见 [push-service](../../../src/pi_secretary/src/push-service.ts)、[push-transport](../../../src/pi_secretary/src/push-transport.ts)。

## 创建目标

使用 local-owner 认证，路径前缀 `/api/v1`。先 `POST push-targets` 创建禁用目标：

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "name": "Phone",
  "kind": "NTFY",
  "endpoint": "https://ntfy.sh",
  "enabled": false,
  "quiet_hours": {"timezone": "Asia/Hong_Kong", "start": "22:00", "end": "08:00"}
}
```

回执关联 target ID，GET push-targets/{id} 读取配置。更新时 POST 同一路径，提供完整配置、新 request_id 和当前 expected_revision；最多 20 个目标，发送 worker 不改变目标 revision。

endpoint 为精确 HTTP(S) origin，如 `https://ntfy.example.com`，无尾斜杠、路径、query、fragment 或 userinfo；MACOS_NOTIFICATION 使用 null。quiet_hours 为 null 或 IANA 时区及不同的 HH:mm 起止时间，跨午夜与夏令时按当地时间处理。远程目标使用 HTTPS，预览通过配置的服务及其下游通知渠道传输。

## 配置凭据并启用

在 Core 数据目录创建权限 0700 的 push-secrets，写入属于 Core 用户、权限 0600 的 `<target UUID>.json`，最大 8 KiB，路径须为普通文件。凭据格式：

```json
{"topic":"replace-with-private-topic","token":"replace-with-access-token"}
```

以上为 NTFY，允许匿名发布的服务可省略 token；BARK 使用 `{"device_key":"replace-with-device-key"}`。也可在启动前设置 `SECRETARY_PUSH_<大写且连字符改为下划线的UUID>` 为相同 JSON，环境优先于文件。凭据不进入公开配置。

写好凭据后启用目标。启用以配置事务水位建立新 generation，发送此后创建的通知。禁用取消待发送项；重新启用或改变 kind/endpoint 建立新 generation，修改名称或免打扰时间保留积压。进行中的请求仍记录实际结果，禁用后失败取消重试。

每次发送重新读取凭据文件；轮换采用同目录 0600 临时文件原子改名，环境凭据通过重启刷新。更换 topic/device key 的目标地址时，先禁用、改凭据，再启用，使旧积压留在原 generation。缺失、格式或权限错误返回 SECRET_UNAVAILABLE；查询保存固定错误码。

## 发送与恢复

每次发送超时 10 秒，响应最多 8 KiB，拒绝重定向，校验渠道成功响应后保存接受状态。NTFY 发送 topic/message/title 及可选 Bearer token，BARK 发送 device_key/body/title；macOS 调用本机 osascript 通知接口。

初次发送后最多重试三次，退避 30 秒、2 分钟、10 分钟。中断尝试也计入四次预算；最后一次中断为 FAILED/INTERRUPTED。重启恢复通知与 dispatch，保留预算及速率记账；渠道接受后、本地结果保存前崩溃可能造成重复发送。

每目标每滚动分钟最多三次尝试，失败同样计数。免打扰暂停尝试；窗口结束或速率槽可用后，积压按最多 100 条合并，重试保持原批次成员。预览最多 200 个 Unicode 字符，附客户端查看提示，JSON 通知仅提取 text 字段。

## 查询与同步

GET push-targets 及 push-targets/{id} 返回配置；GET push-dispatches 可按 target_id、state 筛选，默认 30、最多 100，cursor 绑定筛选。详情包含通知/目标 ID、generation、批次、尝试历史、下次时间、错误码与接受时间；状态为 PENDING/SENDING/DISPATCHED/FAILED/CANCELLED。目标与发送记录进入 sync/changes 和 sync/stream，查询只读。

## 当前限制

- 有界重试耗尽后的记录保留查询，尚无终态失败的重发 API。
- macOS 实际横幅展示取决于系统权限，手机真实送达验收归随身终端 #11。
- 免打扰和重试依赖 Core 运行，settle 不等待未来期限。
