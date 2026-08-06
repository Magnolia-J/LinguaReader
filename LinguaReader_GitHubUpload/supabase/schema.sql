-- =========================================================
-- LinguaReader Workspace · 云端同步建表脚本
-- 在 Supabase 控制台 → SQL Editor 中粘贴执行本文件一次。
--
-- 说明：
--   - 数据按「整包 jsonb」存一行（每个用户一行），由前端逻辑合并多端数据。
--   - 安全由行级安全（RLS）保证：只有登录用户本人能读写自己的那一行。
--   - 这里用的 publishable / anon key 是公开的前端密钥，不涉密；
--     真正的权限隔离靠下面的 RLS 策略。
-- =========================================================

-- 1) 表
create table if not exists public.kb_store (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  payload   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) 行级安全（必须）
alter table public.kb_store enable row level security;

drop policy if exists "kb_store_owner" on public.kb_store;
create policy "kb_store_owner" on public.kb_store
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3) 授予前端匿名/已登录角色访问权限（Supabase 默认已授予，显式声明更稳妥）
grant select, insert, update, delete on public.kb_store to anon, authenticated;

-- 4) 索引（按更新时间排序查询，可选）
create index if not exists kb_store_updated_idx on public.kb_store (updated_at desc);

-- 5) 开启实时推送（手机端才能在桌面端改动后数秒自动刷新；幂等：已加入则跳过）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kb_store'
  ) then
    alter publication supabase_realtime add table public.kb_store;
  end if;
end $$;
