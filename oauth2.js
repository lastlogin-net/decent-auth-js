import { genRandomText, parseAndVerifyJwt } from './utils.js';

async function oidcLogin(req, pathPrefix, kvStore) {

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  const providerUri = params.get('provider_uri');

  const metaRes = await fetch(`${providerUri}/.well-known/openid-configuration`);

  const meta = await metaRes.json();

  const clientId = url.origin;
  const redirectUri = `${url.origin}${pathPrefix}/oidc-callback`;

  const state = genRandomText(32);
  const authUri = `${meta.authorization_endpoint}?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&response_type=code&scope=openid email profile`;

  const authReq = {
    issuer: meta.issuer,
    clientId,
    redirectUri,
    tokenEndpoint: meta.token_endpoint,
  };

  await kvStore.set(`oauth_state/${state}`, authReq);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': authUri,
    },
  });
}


async function oidcCallback(req, kvStore) {

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) {
    return new Response("Missing code or state param", {
      status: 400,
    });
  }

  const authReq = await kvStore.get(`oauth_state/${state}`);
  await kvStore.delete(`oauth_state/${state}`);

  if (!authReq) {
    throw new Error("No such auth request");
  }

  const res = await fetch(authReq.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },    
    body: new URLSearchParams({
      code,
      client_id: authReq.clientId,
      redirect_uri: authReq.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenRes = await res.json();

  const jwt = parseAndVerifyJwt(tokenRes.id_token, authReq.issuer, authReq.clientId);
  
  const session = {
    userIdType: 'email',
    userId: jwt.claims.email,
    data: jwt,
  };

  const sessionKey = genRandomText(32);
  await kvStore.set(`sessions/${sessionKey}`, session);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': '/',
      'Set-Cookie': `session_key=${sessionKey}; Path=/; Max-Age=84600; Secure; HttpOnly`,
    },
  });
}


export {
  oidcLogin,
  oidcCallback,
};
