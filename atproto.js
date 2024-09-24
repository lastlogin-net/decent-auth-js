import { genRandomText } from './utils.js';

async function atprotoClientMetadata(req, pathPrefix) {

  const url = new URL(req.url);

  console.log(url);

  const clientMeta = {
    client_id: `https://${url.hostname}${url.pathname}`,
    redirect_uris: [
      `https://${url.hostname}${pathPrefix}/atproto-callback`,
    ],
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

  const state = genRandomText(32);
  const authUri = `${meta.authorization_endpoint}?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&response_type=code&scope=atproto`;

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
};
