# 部署（Ubuntu + systemd）

> 这份文件是**从零自建服务端**时用的模板：换成你自己的域名、目录和端口即可。
> 官方托管的那一台不在这里描述。

设计稿 §5.1 的一条硬约束决定了这里所有的选择：**正文只在内存，重启即丢（海啸）**。
所以：不要 `Restart=always`，不要在改种子后重启，也不要 `rsync`。

---

## 0. 一次性准备

```bash
sudo useradd --system --create-home --home-dir /srv/bottle --shell /usr/sbin/nologin bottle
sudo mkdir -p /srv/bottle/{app,data,seeds,backups}
sudo chown -R bottle:bottle /srv/bottle
```

Node 22+ 是硬要求（`node --experimental-strip-types` 直接跑 `.ts`，不装 tsx）。

**`backups/` 必须存在**：它是 `bottle-backup.service` 唯一被允许写的地方。

## 1. 放代码

```bash
sudo -u bottle git clone <这个包的仓库或目录> /srv/bottle/app
```

只需要 `server/` 与 `shared/` 两个目录；`world/` 是给客户端装的。

## 2. 种子目录（独立 git 仓库）

种子用**私有 git 仓库**同步，不跟代码放一起：

```bash
sudo -u bottle git clone <种子仓库> /srv/bottle/seeds
```

`git pull --ff-only` 要求种子仓库的历史是线性的——本机 push、服务器只 pull，天然满足。

## 3. 装 unit

```bash
sudo cp deploy/bottle-server.service /etc/systemd/system/
sudo cp deploy/bottle-seeds-pull.{service,timer} /etc/systemd/system/
sudo cp deploy/bottle-backup.{service,timer} /etc/systemd/system/
sudo cp deploy/bottle-backup.sh /usr/local/bin/
sudo chmod 755 /usr/local/bin/bottle-backup.sh

sudo systemctl daemon-reload
sudo systemctl enable --now bottle-server
sudo systemctl enable --now bottle-seeds-pull.timer
sudo systemctl enable --now bottle-backup.timer
```

## 4. 验

```bash
# 进程活着，种子读到了
curl -s http://127.0.0.1:8787/health | jq

# 记下 uptime 的起点
curl -s http://127.0.0.1:8787/health | jq -r .startedAt

# 备份能跑（手动催一次，看有没有产出文件）
sudo systemctl start bottle-backup.service
sudo systemctl status bottle-backup.service --no-pager
ls -lh /srv/bottle/backups/

# 定时器排程对不对
systemctl list-timers bottle-backup.timer --no-pager
```

**§13.6 #13 的验收**：

```bash
# 本机：改 seeds/，push
# 服务器：等 ≤5 分钟，或者手动催一次
sudo systemctl start bottle-seeds-pull.service

curl -s http://127.0.0.1:8787/health | jq '{startedAt, seeds: .seeds | {count, generation, loadedAt, errors}}'
```

- `seeds.generation` 变大 → 热载成功
- `startedAt` **没变** → 进程没重启（这就是验收要求的那一条）
- `seeds.errors` 非空 → 有坏文件被跳过，旧版保留着

> `/health` 只报种子目录的**名字**（`seeds`），不报绝对路径——它是无鉴权探针，公网谁都能读。

## 5. 反代（Caddy）

服务端只讲 HTTP，TLS 交给 Caddy：

```caddy
<你的域名> {
    reverse_proxy 127.0.0.1:8787
    log {
        output file /var/log/caddy/bottle.log
    }
}
```

`HOST=0.0.0.0` 只在有反代或需要两台机器直连时用；本机验证留 `127.0.0.1`。

## 6. 热载参数：`tuning.json`

**改数值不该重启。** 重启就是海啸，而海啸会把还漂在海面上的信全拍碎。

`/srv/bottle/data/tuning.json`（5 秒内自动生效，**不用重启**）：

```json
{
  "seedsPerDay": 2,
  "seedsGlobalOnce": true,
  "seedsEnabled": true
}
```

| 键 | 含义 |
|---|---|
| `seedsPerDay` | 系统邮件每人每天最多几封。`0` = 停发 |
| `seedsGlobalOnce` | `true` = 同一封种子**全服**只能被领一次（一封信只属于一个人）；`false` = 只按人去重，同一封人人可领 |
| `seedsEnabled` | 总开关 |

文件不在或写坏了 → 沿用上一次读到的值，不会把海搞挂。
环境变量 `BOTTLE_SEEDS_PER_DAY` / `BOTTLE_SEEDS_GLOBAL_ONCE` / `BOTTLE_SEEDS_ENABLED` 可以当兜底。

> **注意 `seedsGlobalOnce: true` 的含义**：库里有多少封就只够发多少个人。
> 90 封 = 全服一共只发出 90 封系统邮件，之后这条通道就空了，直到你加新种子。
> 想让它细水长流且人人有份，设成 `false`。

## 7. 海啸记账：这次重启是计划内还是意外

服务端每次启动都会检查磁盘上有没有「还漂着」的信。有，就判定为一次海啸，
记下**时间 / 原因 / 丢了几封**，并通过 `/quota` 告诉客户端，客户端再推一个
`bottle.tsunami` 事件给 Coo（人类会听到「海上起了一场海啸」）。

**重启前写一句原因**，两种写法都行：

```bash
# 写法一：只对下一次重启生效，读完即删
echo "上线 v0.2：加了系统邮件通道" | sudo -u bottle tee /srv/bottle/data/next-tsunami-reason.txt

# 写法二：环境变量（写进 unit 或用 systemd-run）
sudo systemctl set-environment BOTTLE_TSUNAMI_REASON="上线 v0.2"
```

不写就记成 `unplanned` —— **那通常意味着崩溃、断电或 OOM，是唯一需要人事后看一眼的那一类**。
没有这个字段，「计划发布」和「意外崩溃」在日志里长得一模一样。

看记录：

```bash
curl -s http://127.0.0.1:8787/health | jq .           # 计数在 /quota 里，需要 token
sudo -u bottle cat /srv/bottle/data/bottle.json | jq .tsunami
```

## 8. 从备份恢复

备份每 8 小时一份（`:05` 跑：00:05 / 08:05 / 16:05），保留 30 天，每份都过了 JSON 解析校验。

```bash
# 1. 停服务（这一步必然海啸，先写好原因）
echo "从备份恢复" | sudo -u bottle tee /srv/bottle/data/next-tsunami-reason.txt
sudo systemctl stop bottle-server

# 2. 挑一份好的
ls -lh /srv/bottle/backups/

# 3. 换回来（先把坏文件留个痕）
sudo -u bottle mv /srv/bottle/data/bottle.json /srv/bottle/data/bottle.json.broken
sudo -u bottle cp /srv/bottle/backups/bottle-20261029-0805.json /srv/bottle/data/bottle.json

# 4. 起来
sudo systemctl start bottle-server
curl -s http://127.0.0.1:8787/health | jq
```

**为什么备份是必需的**：`Db.load()` 解析失败时会**当空库处理**，那会清空 `bots` 表 ——
每个人的 token 都认不出来，客户端 401 后自动重注册，于是**所有人变成新人**（新化名、新额度、
忘了领过哪些系统邮件）。海啸只丢「还漂着的信」，文件损坏丢的是「你是谁」。

## 9. 不要做的事

| 别做 | 为什么 |
|---|---|
| `systemctl restart bottle-server` 来让新种子或新参数生效 | 种子和 `tuning.json` **都是热载的**；重启会海啸，所有还漂着的信全没了 |
| `rsync --delete` 同步种子 | 手滑一次服务器上就没了；git 有历史 |
| `Restart=always` | 崩了要人看一眼，而不是悄悄冲掉海里的信 |
| 把正文写进日志 | 日志只该有 id 和数量（`debug` 也只多记这些） |
| 把种子仓库设成公开 | 等于剧透 |
| 删掉 `/srv/bottle/backups` | 那是文件损坏时唯一的退路 |

### 出问题时先看这三个地方

| 症状 | 查什么 |
|---|---|
| 种子没更新 | `curl /health \| jq .seeds`：`errors` 有没有、`generation` 变没变 |
| 备份没产出 | `systemctl status bottle-backup.service`、`journalctl -t bottle-backup -n 50` |
| 参数改了没反应 | `tuning.json` 的 mtime 变了没、JSON 有没有写坏（5 秒内不生效就多半是写坏了） |
