import { genRandomText, parseAndVerifyJwt } from './utils.js';
import { generateChallengeData } from './oauth2.js';

async function oidcLogin(req, pathPrefix, kvStore, providerUri) {

  const url = new URL(req.url);

  const metaRes = await fetch(`${providerUri}/.well-known/openid-configuration`);

  const meta = await metaRes.json();

  return oidcLoginWithMeta(req, pathPrefix, kvStore, meta);
}

function oidcClientMetadata(unparsedUrl, pathPrefix) {

  const url = new URL(unparsedUrl);

  const clientMeta = {
    client_id: `https://${url.hostname}${pathPrefix}/oidc-client`,
    application_type: 'web',
    client_name: 'Decent Auth Client',
    client_uri: `https://${url.hostname}`,
    dpop_bound_access_tokens: true,
    grant_types: [
      'authorization_code',
      'refresh_token',
    ],
    redirect_uris: [
      `https://${url.hostname}${pathPrefix}/oidc-callback`,
    ],
    response_types: [
      'code'
    ],
    scope: 'openid email profile',
    token_endpoint_auth_method: 'none',
  };

  return Response.json(clientMeta);
}

async function oidcLoginWithMeta(req, pathPrefix, kvStore, meta) {

  const url = new URL(req.url);

  //const clientId = url.origin;
  const clientId = `https://${url.hostname}${pathPrefix}/oidc-client`;
  const redirectUri = `https://${url.hostname}${pathPrefix}/oidc-callback`;

  const pkce = await generateChallengeData();

  const state = genRandomText(32);
  const authUri = `${meta.authorization_endpoint}?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&response_type=code&scope=openid email profile&code_challenge=${pkce.challenge}&code_challenge_method=S256`;

  const authReq = {
    issuer: meta.issuer,
    clientId,
    redirectUri,
    tokenEndpoint: meta.token_endpoint,
    codeVerifier: pkce.verifier,
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
      code_verifier: authReq.codeVerifier,
    }),
  });

  const tokenRes = await res.json();

  const jwt = parseAndVerifyJwt(tokenRes.id_token, authReq.issuer, authReq.clientId);

  let email;
  if (jwt.claims.email) {
    email = jwt.claims.email;
  }
  else if (jwt.claims.preferred_username) {
    // TODO: hack for Weird+Rauthy since it doesn't return email. Probably
    // won't work for other servers.
    email = jwt.claims.preferred_username;
  }
  
  const session = {
    userIdType: 'email',
    userId: email,
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
  oidcLoginWithMeta,
  oidcCallback,
  oidcClientMetadata,
};
