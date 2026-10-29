// 请求一枚 npm 的 OIDC 令牌，解开载荷，逐项打印 npm 端要看的那几个 claim。
// 这里只读不写：没有任何密钥，令牌本身也不落盘。
import fs from 'node:fs';

const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!url || !token) {
  console.error('没有 OIDC 环境变量：这个 job 需要 permissions.id-token: write');
  process.exit(1);
}

const res = await fetch(`${url}&audience=npm:registry.npmjs.org`, {
  headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
});
if (!res.ok) {
  console.error('取令牌失败', res.status, await res.text());
  process.exit(1);
}
const { value } = await res.json();
const payload = value.split('.')[1];
const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

const fields = [
  'iss',
  'aud',
  'sub',
  'repository',
  'repository_owner',
  'repository_id',
  'ref',
  'event_name',
  'workflow',
  'workflow_ref',
  'job_workflow_ref',
  'environment',
  'runner_environment',
];

const lines = fields.map((key) => `${key.padEnd(20)} ${claims[key] ?? '(缺席)'}`);
lines.push('');
lines.push('=== npm Trusted publisher 四个字段应该怎么填 ===');
lines.push(`Organization or user : ${String(claims.repository ?? '').split('/')[0]}`);
lines.push(`Repository           : ${String(claims.repository ?? '').split('/')[1]}`);
lines.push(`Workflow filename    : ${String(claims.workflow_ref ?? '').split('/').pop()?.split('@')[0] ?? '(未知)'}`);
lines.push(`Environment name     : ${claims.environment ?? '(留空)'}`);

const text = lines.join('\n');
console.log(text);
fs.writeFileSync('claims.txt', text + '\n');
