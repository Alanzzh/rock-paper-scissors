# Google OAuth 配置指南

## 1. 创建 Google Cloud 项目

1. 访问 https://console.cloud.google.com/
2. 点击顶部的项目下拉菜单
3. 点击 "新建项目"
4. 输入项目名称：`rock-paper-scissors`
5. 点击 "创建"

## 2. 启用 Google+ API

1. 在左侧菜单选择 "API 和服务" > "库"
2. 搜索 "Google+ API"
3. 点击并启用

## 3. 创建 OAuth 凭据

1. 在左侧菜单选择 "API 和服务" > "凭据"
2. 点击 "创建凭据" > "OAuth 客户端 ID"
3. 如果提示配置同意屏幕，点击 "配置同意屏幕"：
   - 用户类型：选择 "外部"
   - 应用名称：`石头剪刀布 Online`
   - 用户支持电子邮件：你的邮箱
   - 开发者联系信息：你的邮箱
   - 点击 "保存并继续"
   - 作用域：跳过
   - 测试用户：添加你的 Google 账号
   - 点击 "保存并继续"

4. 返回创建凭据：
   - 应用类型：选择 "Web 应用"
   - 名称：`rock-paper-scissors-web`
   - 已获授权的重定向 URI：
     - 本地测试：`http://localhost:3000/auth/google/callback`
     - Railway 部署：`https://你的域名.up.railway.app/auth/google/callback`
   - 点击 "创建"

5. 复制显示的：
   - 客户端 ID
   - 客户端密钥

## 4. 配置环境变量

### 本地开发

创建 `.env` 文件：

```bash
GOOGLE_CLIENT_ID=你的客户端ID
GOOGLE_CLIENT_SECRET=你的客户端密钥
CALLBACK_URL=http://localhost:3000/auth/google/callback
SESSION_SECRET=随机生成的密钥
```

### Railway 部署

1. 打开 Railway 项目
2. 点击 "Variables" 标签
3. 添加以下变量：
   - `GOOGLE_CLIENT_ID`: 你的客户端ID
   - `GOOGLE_CLIENT_SECRET`: 你的客户端密钥
   - `CALLBACK_URL`: `https://你的域名.up.railway.app/auth/google/callback`
   - `SESSION_SECRET`: 随机生成的密钥

4. 重新部署项目

## 5. 测试

1. 访问你的应用
2. 点击 "使用 Google 登录"
3. 选择 Google 账号
4. 授权应用
5. 自动返回并显示你的头像和名字

## 注意事项

- 开发阶段应用处于"测试"状态，只有添加的测试用户可以登录
- 要公开发布，需要提交 OAuth 同意屏幕审核
- 确保 `.env` 文件已添加到 `.gitignore`，不要提交到 GitHub
