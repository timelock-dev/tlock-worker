use drand_core::{beacon::ApiBeacon, chain::ChainInfo};
use worker::*;

fn log_request(req: &Request) {
    console_log!(
        "{} - [{}], located at: {:?}, within: {}",
        Date::now().to_string(),
        req.path(),
        req.cf().coordinates().unwrap_or_default(),
        req.cf().region().unwrap_or_else(|| "unknown region".into())
    );
}

#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: worker::Context) -> Result<Response> {
    log_request(&req);

    let router = Router::new();

    let mut response = router
        .get("/", |_, _| Response::ok(include_str!("index.html")))
        .post_async("/encrypt/:round", |mut req, ctx| async move {
            let info: ChainInfo = Fetch::Url(Url::parse("https://drand.cloudflare.com/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info")?).send().await?.json().await?;
            let round = match ctx.param("round") {
                Some(r) => r.parse::<u64>().unwrap(),
                None => return Response::error("round invalid", 400),
            };

            let src = req.bytes().await?;

            let mut armored = tlock_age::armor::ArmoredWriter::wrap_output(vec![]).unwrap();
            tlock_age::encrypt(
                &mut armored,
                src.as_slice(),
                &info.hash(),
                &info.public_key(),
                round,
            )
            .unwrap();
            let encrypted = armored.finish().unwrap();
            Response::from_bytes(encrypted)
        })
        .post_async("/decrypt", |mut req, _ctx| async move {
            let info: ChainInfo = Fetch::Url(Url::parse("https://drand.cloudflare.com/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info")?).send().await?.json().await?;

            let src = req.bytes().await?;
            let round = tlock_age::decrypt_header(src.clone().as_slice()).unwrap().round();

            let mut decrypted = vec![];
            let beacon: ApiBeacon = Fetch::Url(Url::parse(&format!("https://drand.cloudflare.com/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/{round}"))?).send().await?.json().await?;
            let signature = beacon.signature();
            match tlock_age::decrypt(
                &mut decrypted,
                src.as_slice(),
                &info.hash(),
                &signature,
            ) {
                Ok(_) => Response::from_bytes(decrypted),
                Err(_) => Response::error("decryption error", 500)
            }
        })
        .run(req, env)
        .await?;

        let mut headers = Headers::new();
        let _ = headers.set("Access-Control-Allow-Origin", "*");
        let _ = headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        let _ = headers.set("Access-Control-Allow-Headers", "*");
        let _ = headers.set("Access-Control-Allow-Credentials", "true");
        response = response.with_headers(headers);

    Ok(response)
}
