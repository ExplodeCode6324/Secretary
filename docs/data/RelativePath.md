# RelativePath

相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/RelativePath)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "minLength": 1,
  "description": "相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。",
  "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\x00]+$"
}
```
