# Desplegar Lúca

Lúca es una aplicación **full-stack**: servidor Node + base de datos SQLite en disco +
archivos subidos al sistema de ficheros. Necesita un host con **servidor persistente y
disco escribible**.

## ⛔ Dónde NO funciona tal cual

- **Netlify / Vercel / Cloudflare Pages** — ejecutan Next.js como funciones serverless con
  sistema de archivos efímero. La base de datos SQLite no puede vivir ahí: el login se queda
  cargando porque la API no encuentra (ni puede crear) la base de datos.
  *Para usar estas plataformas habría que migrar la base de datos a un servicio alojado
  (Turso/libSQL, Neon o Supabase Postgres) — es un cambio de código, no de configuración.*

## ✅ Opción recomendada: Railway (5 minutos)

1. Sube el proyecto a un repositorio de GitHub (el `Dockerfile` ya está incluido).
2. En [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**.
   Railway detecta el Dockerfile automáticamente.
3. Añade un **Volume** montado en `/app/data` (para que la base de datos sobreviva a los
   redespliegues).
4. Variables de entorno:
   - `AUTH_SECRET` = una cadena larga y aleatoria (obligatorio en producción)
   - `ANTHROPIC_API_KEY` = opcional, activa el nivel LLM del copiloto
   - `SEED_DEMO` = `true` solo si quieres que se cree la empresa de demostración
     (login `aaron@caracoffee.ie` / `demo1234`). **Por defecto no se siembra nada:**
     los usuarios se registran en `/signup` y crean sus propias empresas vacías.
5. Deploy. En el primer arranque el contenedor crea el esquema y arranca la aplicación.

## ✅ Render

- **New → Web Service → Docker**, apunta al repo.
- Añade un **Persistent Disk** montado en `/app/data` (1 GB basta).
- Mismas variables de entorno que arriba.

## ✅ Fly.io

```bash
fly launch --no-deploy        # detecta el Dockerfile
fly volumes create luca_data --size 1
# en fly.toml añade:
#   [mounts]
#     source = "luca_data"
#     destination = "/app/data"
fly secrets set AUTH_SECRET=<cadena-aleatoria>
fly deploy
```

## ✅ VPS propio (Hetzner, DigitalOcean…)

```bash
docker build -t luca .
docker run -d -p 3000:3000 -v luca-data:/app/data \
  -e AUTH_SECRET=<cadena-aleatoria> --name luca luca
```

Pon un proxy con HTTPS delante (Caddy lo hace en dos líneas).

## Comprobación rápida

Si el login se queda cargando, mira los logs del servidor: casi siempre es
(a) base de datos inexistente → ejecuta `npx drizzle-kit push && npx tsx src/db/seed.ts`,
o (b) `AUTH_SECRET` sin definir en producción.


## Actualizar una versión ya desplegada

Railway (y Render) redespliegan solos cada vez que haces `git push` a la rama conectada:

```bash
git add .
git commit -m "actualizacion"
git push
```

Al arrancar, el contenedor aplica automáticamente los cambios de esquema
(`drizzle-kit push`), que son aditivos y seguros de repetir.

**Excepción — columnas nuevas obligatorias.** SQLite no permite añadir una columna
`NOT NULL` a una tabla que ya tiene filas sin recrearla. Si en los logs aparece
`SCHEMA PUSH FAILED`, hay dos caminos:

- **La base de datos no tiene datos reales** (solo la demo, o está recién creada):
  borra el volumen en Railway (*Volume → Settings → Delete*), créalo de nuevo con el
  mismo punto de montaje `/app/data` y redespliega. El esquema se crea limpio.
- **La base de datos sí tiene datos reales:** escribe una migración explícita antes de
  desplegar (`npx drizzle-kit generate`, aplicada con `drizzle-kit migrate`) para no
  perder nada.

Los logs de arranque son explícitos: busca las líneas que empiezan por `[luca]` en
**Deployments → View Logs**.
