# tlock-worker

This fork adds a simple web interface.

Demonstration worker supporting timelock encryption.

## Usage

If you'd like to perform local encryption and decryption, you can install `dee`. Pre-build binaries are available on [GitHub](https://github.com/thibmeu/drand-rs/releases).

The worker is configured to use quicknet `https://drand.cloudflare.com/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`.

### Encryption

**Only supported for a fixed round number when using the worker.**

* local: `dee crypt -r 1000 original.png > encrypted.pem`
* remote: `curl -X POST --data-binary @original.png https://tlock-worker.crypto-team.workers.dev/encrypt/1000 > encrypted.pem`

### Decryption

* local: `dee crypt --decrypt encrypted.pem > decrypted.png`
* remote: `curl -X POST --data-binary @encrypted.pem https://tlock-worker.crypto-team.workers.dev/decrypt > decrypted.png`


## Development

This template starts you off with a `src/lib.rs` file, acting as an entrypoint for requests hitting your Worker. Feel free to add more code in this file, or create Rust modules anywhere else for this project to use.

With `wrangler`, you can build, test, and deploy your Worker with the following commands:

```sh
# run your Worker in an ideal development workflow (with a local server, file watcher & more)
$ npm run dev

# deploy your Worker globally to the Cloudflare network (update your wrangler.toml file for configuration)
$ npm run deploy
```

Read the latest `worker` crate documentation here: https://docs.rs/worker
