
async function indieAuthLogin(req, pathPrefix, kvStore, proto) {

  console.log(proto);

  return new Response("IndieAuth not yet supported", {
    status: 400,
  });
}

async function lookupIndieAuthServer(parsedUrl) {

  let canonUrl = `https://${parsedUrl.hostname}${parsedUrl.pathname}`;
  if (!canonUrl.endsWith('/')) {
    canonUrl += '/';
  }

  const res = await fetch(canonUrl, {
    method: 'HEAD',
  });

  const linkHeaders = parseLinkHeaders(res.headers.get('Link'));

  let link;
  for (const header of linkHeaders) {
    if (header.rel === 'indieauth-metadata') {
      link = header.link;
      break;
    }
  }

  if (!link) {
    return null;
  }

  const asMeta = fetch(link).then(res => {
    if (!res.ok) {
      return null;
    }

    return res.json();
  });

  return asMeta;
}

function parseLinkHeaders(headerText) {

  const allHeadersText = headerText.split(',').map(p => p.trim());

  const headers = [];

  for (const headerText of allHeadersText) {
    const [ rawLink, rawRel ] = headerText.split(';').map(p => p.trim());
    const link = parseLink(rawLink);
    const rel = parseRel(rawRel);

    headers.push({
      link,
      rel,
    });
  }

  return headers;
}

function parseRel(relText) {
  return relText.split('=')[1].replaceAll("'", '').replaceAll('"', '');
}

function parseLink(linkText) {
  return linkText
    .replaceAll('"', '')
    .replaceAll("'", '')
    .replaceAll('<', '')
    .replaceAll('>', '');
}

export {
  indieAuthLogin,
  lookupIndieAuthServer,
};
