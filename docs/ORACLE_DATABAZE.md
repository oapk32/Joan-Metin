# Joan Metiny Online – Oracle PostgreSQL

The Oracle Linux VM already runs PostgreSQL 16 locally, with database `joan_metiny`,
role `joan_app` and the initial `accounts` / `characters` tables.

This development step adds a Node.js PostgreSQL connector and a standalone
connection diagnostic. **It does not yet implement registration, login, character
saving, server-authoritative gameplay, or public access.**

## Install on Oracle

From the SSH console (user `opc`):

```bash
cd ~/Joan-Metin-MP
git pull --ff-only origin multiplayer-dev
cd server
npm install
npm test
```

## Check Node.js → PostgreSQL

Run the following command. It asks for the password without echoing it, and
does not save it in shell history or in Git:

```bash
read -r -s -p "PostgreSQL joan_app password: " PGPASSWORD; echo
export PGPASSWORD
npm run db:check
unset PGPASSWORD
```

Expected: `PostgreSQL connection OK: joan_app joan_metiny 16...`

PostgreSQL listens on the local loopback address and its port 5432 must not
be opened to the Internet. Do not commit passwords, `.env` files, SSH keys,
or a `.pgpass` file.

## Next development

Implement migrations, password hashing (Argon2id), session management,
authoritative character ownership and transactional saves. Only after these
and protective rate limits are tested should the project be publicly exposed.
