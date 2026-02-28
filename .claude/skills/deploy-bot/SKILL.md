# Deploy Bot

Builds the bot Docker image, pushes it to the registry, and optionally deploys to Pipecat Cloud.

## Parameters

Ask the user for:
- **Image tag**: Read the default from `deployment/pcc-deploy.toml` (the `image` field). Show the user the default and ask if they want to use it or enter a custom image tag.
- **Platform**: Ask if they want to build for `linux/arm64` (default, required for Pipecat Cloud — the base image `dailyco/pipecat-base` is arm64-only) or their local platform.

## Steps

### 1. Read image tag from pcc-deploy.toml

Parse `deployment/pcc-deploy.toml` to get the configured `image` value. Present this to the user as the default.

### 2. Build the Docker image

```bash
docker build --platform linux/arm64 -f deployment/Dockerfile.bot -t <image_tag> .
```

If the user chose their local platform, omit the `--platform` flag.

### 3. Push the Docker image

```bash
docker push <image_tag>
```

If the push fails with an authentication error, tell the user to run `docker login` first and retry.

### 4. Ask whether to deploy to Pipecat Cloud

After the image is built and pushed, ask the user if they also want to deploy the bot to Pipecat Cloud. They may just want to build and push the image without updating the running bot.

If **yes**, proceed to step 5. If **no**, skip to step 6.

### 5. Deploy to Pipecat Cloud

```bash
cd deployment/ && pipecat cloud deploy --no-credentials --force
```

The `--force` flag skips the interactive confirmation prompt. Use `--no-credentials` since the image is public. If the user indicates the image is private, omit `--no-credentials` so Pipecat Cloud uses configured image pull credentials.

### 6. Verify

Report what was completed (build + push, and optionally deploy). The deploy command has a 90-second health check window that will often time out with a message like "Deployment did not enter ready state within 90 seconds." This is normal and expected — the deployment was still submitted successfully. Treat this as a successful deploy and report the agent name.

## Important notes

- The Dockerfile is at `deployment/Dockerfile.bot`.
- The Pipecat Cloud deploy config is at `deployment/pcc-deploy.toml`.
- The image tag in `pcc-deploy.toml` must match what you build and push. If the user provides a custom tag, update `pcc-deploy.toml` to match before deploying.
- Secrets should already be configured on Pipecat Cloud (`pipecat cloud secrets set gb-bot-secrets --file .env.bot`). If the user hasn't set secrets yet, remind them to do so.
- Build context is the repo root (`.`), not the `deployment/` directory.
