import { genRandomText } from './utils.js';
import { generateChallengeData } from './oauth2.js';

async function atprotoClientMetadata(req, pathPrefix) {

  const url = new URL(req.url);

  const clientMeta = {
    client_id: `https://${url.hostname}${url.pathname}`,
    application_type: 'web',
    client_name: 'Decent Auth Client',
    client_uri: `https://${url.hostname}`,
    dpop_bound_access_tokens: true,
    grant_types: [
      'authorization_code',
      'refresh_token',
    ],
    redirect_uris: [
      `https://${url.hostname}${pathPrefix}/atproto-callback`,
    ],
    response_types: [
      'code'
    ],
    scope: 'atproto transition:generic',
    token_endpoint_auth_method: 'none',
  };

  return new Response(JSON.stringify(clientMeta), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function atprotoLogin(req, pathPrefix, kvStore) {

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  const id = params.get('id');

  const didData = await resolveDid(id);
  const meta = await lookupAuthServer(didData);

  const clientId = `https://${url.hostname}${pathPrefix}/client-metadata.json`;
  const redirectUri = `https://${url.hostname}${pathPrefix}/atproto-callback`;

  const pkce = await generateChallengeData();

  const state = genRandomText(32);
  const authUri = `${meta.authorization_endpoint}?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&code_challenge=${pkce.challenge}&code_challenge_method=S256&response_type=code&scope=atproto`;

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

async function atprotoCallback(req, pathPrefix, kvStore) {

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  const state = params.get('state');
  if (!state) {
    return new Response("Missing state param", {
      status: 400,
    });
  }

  const error = params.get('error');
  if (error) {
    const errorDesc = params.get('error_description');
    return new Response(errorDesc, {
      status: 400,
    });
  }

  const code = params.get('code');
  if (!code) {
    return new Response("Missing code param", {
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

  const data = await res.json();
  console.log(data);

  if (res.status !== 200) {
    return new Response("Failed to get token", {
      status: 500,
    });
  }

  return new Response(null, {
    status: 200,
  });
}

async function lookupAuthServer(didData) {
  const uri = `${didData.service[0].serviceEndpoint}/.well-known/oauth-protected-resource`;
  const res = await fetch(uri);
  const data = await res.json();
  const authServer = data.authorization_servers[0];

  const asUri = `${authServer}/.well-known/oauth-authorization-server`;
  const asRes = await fetch(asUri);
  const asMeta = await asRes.json();
  return asMeta;
}

async function resolveDid(didDomain) {

  const did = await lookupDid(didDomain);

  if (!did.startsWith('did:plc')) {
    throw new Error("Unsupported did type: " + did);
  }

  const uri = `https://plc.directory/${did}`;
  const didDataRes = await fetch(uri);
  const didData = await didDataRes.json();

  return didData;
}

async function lookupDid(domain) {
  const didDomain = `_atproto.${domain}`;

  const res = await lookupDnsRecords(didDomain, 'TXT');

  let did;
  for (const record of res.Answer) {
    if (record.name === didDomain) {
      // TODO: not sure what format this is supposed to be
      const didTxt = JSON.parse(record.data);
      const didParts = didTxt.split('=');
      did = didParts[1];
      break;
    }
  }

  if (!did) {
    throw new Error("DID not found");
  }

  return did;
}

const dohServer = 'https://cloudflare-dns.com';
async function lookupDnsRecords(domain, type) {
  const uri = `${dohServer}/dns-query?name=${domain}&type=${type}`;
  const recRes = await fetch(uri, {
    headers: {
      'Accept': 'application/dns-json',
    },
  });
  const recs = await recRes.json();
  return recs;
}

export {
  atprotoLogin,
  atprotoClientMetadata,
  atprotoCallback,
};
