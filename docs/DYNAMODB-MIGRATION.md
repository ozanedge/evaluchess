# DynamoDB migration

The browser and Vercel API stay in place. DynamoDB replaces Upstash for all
server state: accounts, sessions, matchmaking, games, ratings, presence, and
rate limits. No Redis client or paid telemetry service is needed at runtime.

## Provision the table and runtime role

Use an explicitly selected AWS account/profile and region. The CloudFormation
stack creates an on-demand table, the leaderboard index, TTL cleanup,
point-in-time recovery, deletion protection, and a role restricted to this table.
The table is retained if the stack is deleted. On-demand reads/writes, storage,
and backups incur AWS charges; capacity servers do not need to be managed.

Enable Vercel OIDC with the **team issuer** in this project's security settings.
Use the team slug (not its `team_...` ID). The trust policy matches the exact
team, project name and deployment environment. Preview must use its own stack
and role: it must never share the production table.

```sh
node infra/stack.mjs > infra/dynamodb.json
aws cloudformation deploy --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name evaluchess-production \
  --template-file infra/dynamodb.json --capabilities CAPABILITY_IAM \
  --parameter-overrides TableName=evaluchess-production \
    VercelTeamSlug=YOUR_TEAM_SLUG VercelProjectName=evaluchess \
    VercelEnvironment=production
aws cloudformation describe-stacks --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name evaluchess-production --query 'Stacks[0].Outputs'
```

If that AWS account already has the team's OIDC provider, pass
`ExistingOidcProviderArn=arn:aws:iam::ACCOUNT:oidc-provider/oidc.vercel.com/TEAM`.
The existing provider must have audience `https://vercel.com/TEAM`. This template
uses the team issuer; it does not trust the global issuer or wildcard projects.

Set these **server-only** Vercel variables from stack outputs:

| Variable | Value |
| --- | --- |
| `DYNAMODB_TABLE` | `TableName` output |
| `DYNAMODB_REGION` | `Region` output |
| `AWS_ROLE_ARN` | `RuntimeRoleArn` output |

Do not add AWS access keys. The official Vercel AWS credentials provider exchanges
the deployment's OIDC token for temporary credentials. The explicitly configured
DynamoDB region takes precedence over the Vercel runtime's `AWS_REGION`.
Do not set `DYNAMODB_ENDPOINT` in Vercel; the API rejects it there.

## Transfer existing accounts and ratings

The operator tool uses standard local AWS credentials, not the runtime role.
It requires GetItem and PutItem permissions on the destination table (including
transactional writes). Keep the export outside the repository: it includes
password hashes. Export creates a new file with mode 0600 and refuses to
replace an existing file. Never commit, attach, or print it.

1. Test a separate preview stack first: sign up, sign in, match two browsers,
   complete a rated game, reload, and check the leaderboard.
2. Arrange a maintenance window. Stop bot workers and prevent writes to the old
   deployment, including old tabs and deployment URLs. Let games finish or tell
   players they will need to start new games. Do not simply export while the old
   application can still accept signups or rated game results.
3. Supply the old `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the
   operator's environment from the secret store. These are used only for export.
   Export is read-only; it never deletes old Redis data.
4. Export, import, then verify with the destination still closed to players:

```sh
node scripts/migrate-storage.mjs export /secure/path/accounts.json
AWS_PROFILE=YOUR_PROFILE DYNAMODB_REGION=YOUR_REGION \
  DYNAMODB_TABLE=evaluchess-production \
  node scripts/migrate-storage.mjs import /secure/path/accounts.json
AWS_PROFILE=YOUR_PROFILE DYNAMODB_REGION=YOUR_REGION \
  DYNAMODB_TABLE=evaluchess-production \
  node scripts/migrate-storage.mjs verify /secure/path/accounts.json
```

The file contains account IDs, usernames, exact scrypt password hashes and all
rating counters. Source username lookups must match the account IDs. Missing or
invalid ratings stop the export; they are never replaced with a starting rating.
The importer validates the whole file before writing, then writes each account,
username lookup and indexed rating atomically. It never overwrites existing
records. Interrupted imports can resume when existing records match exactly.
A conflict stops the run; earlier accounts may already have imported. Verification
compares all exported records and index attributes using strongly consistent reads.

Sessions, queued players, rate limits, presence and active games are deliberately
not transferred. Users must sign in again. Local browser game history is unchanged.
An unavailable source must be restored or recovered from a backup before claiming
that accounts have migrated; an empty replacement database is not a migration.

## Cut over and verify

Deploy the new UI and API together with the production table/role configured.
Before reopening traffic, verify sign-in with an existing account, its rating,
and the leaderboard, then test a new account and a two-player rated game. Confirm
both ratings change only once after repeated result polling. Check Vercel logs
for IAM/OIDC errors without logging cookies, passwords, or full database items.

The current 24-hour leaderboard uses strongly consistent result queries and caches
successful responses for 30 seconds. Account/game reads are strongly consistent. Database
failures return 503; the leaderboard offers Retry and does not report a failure
as an empty list. TTL is cleanup only: application reads enforce expiry even
before AWS removes the item.

### Previous all-time wins leaderboard rollout

The all-time leaderboard uses `leaderboard-wins`, ordered by the numeric `wins`
attribute copied from the authoritative rating in each atomic result write.
The original Elo index remains available for compatibility and backfilling.
Update the CloudFormation stack from `infra/dynamodb.json` first, including the
runtime role's permission to query the new index. Wait for the new index to show
`ACTIVE` before deploying the wins-reading API.

For existing tables, run this operator command from the repository root (omit
`--apply` to preview):

```sh
AWS_PROFILE=skynetops DYNAMODB_REGION=us-west-2 DYNAMODB_TABLE=evaluchess-production \
  node --import ./chesscomputers/node_modules/tsx/dist/loader.mjs \
  scripts/backfill-leaderboard-wins.ts --apply
```

It pages through the old index, reads current records consistently, and uses
conditional writes to copy win totals without changing ratings or results.
Run it before deployment and again after the old API's in-flight requests finish:
old writers do not yet preserve the new index field. A final dry run should
report zero changes. Test with `tests/leaderboard.mjs` using the same `tsx`
loader and DynamoDB Local environment as the bot tests.

### Rolling 24-hour leaderboard rollout

The current leaderboard reads dated results from two UTC-day partitions in the
existing table. It needs no additional index, runtime permissions, service or
scheduled job. A completed rated game writes its result in the same transaction
as both lifetime ratings. Reads select exactly `(now - 24 hours, now]`, aggregate
W/L/D and rating changes, then take the top ten by wins. Result TTL is two days;
expiry from the ranking does not depend on DynamoDB deleting an item.

Recover the last day's retained, completed rated games with this operator tool:

```sh
AWS_PROFILE=skynetops DYNAMODB_REGION=us-west-2 DYNAMODB_TABLE=evaluchess-production \
  node --import ./chesscomputers/node_modules/tsx/dist/loader.mjs \
  scripts/backfill-recent-results.ts --apply
```

Omit `--apply` to preview. This one-time migration requires operator Scan/GetItem
and transactional PutItem permissions; the runtime role still has no Scan access.
It checks the source game version, writes missing results conditionally, and does
not change source games or account totals. Run before deployment and again after
old requests finish. A final preview should show zero missing results. Retention
limits recovery to stored games; lifetime totals are never assigned invented dates.

Retain the old deployment, source data and private export during validation.
After verification, remove the Upstash integration/environment variables from
Vercel and retire its database subscription. Do not delete the source before
account and rating transfer is verified.

Before new writes, a rollback can restore the old deployment and source. Once
DynamoDB accepts new accounts or game results, Redis is stale: do not switch back
without freezing writes and reconciling the new data. There is no dual-write
period or automatic reverse migration.

## Local validation

Run the build, lint, core tests, and DynamoDB Local API/browser suites described
in README.md. The API suite covers transaction rollback, expired records that
TTL has not deleted, matchmaking races, exact-once results, concurrent games
sharing a player, account migration/password reuse, import conflicts, rate
limits, and storage outage responses. No test uses an AWS account or live data.

Official references: [Vercel AWS OIDC](https://vercel.com/docs/oidc/aws),
[DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html),
[DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html).
