import crypto from 'crypto-js';

const SigV4Utils = {
  getSignedUrl(host, region, accessKey, secretKey, sessionToken) {
    const time = new Date();
    const dateStamp = time.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const service = 'iotdevicegateway';
    const algorithm = 'AWS4-HMAC-SHA256';
    const method = 'GET';
    const canonicalUri = '/mqtt';

    const credentialScope = `${dateStamp.slice(0, 8)}/${region}/${service}/aws4_request`;

    const canonicalQuerystring = `X-Amz-Algorithm=${algorithm}&X-Amz-Credential=${encodeURIComponent(
      `${accessKey}/${credentialScope}`
    )}&X-Amz-Date=${dateStamp}&X-Amz-SignedHeaders=host`;

    let canonicalHeaders = `host:${host}\n`;
    let signedHeaders = 'host';
    let payloadHash = crypto.SHA256('').toString(crypto.enc.Hex);
    let canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const stringToSign = `${algorithm}\n${dateStamp}\n${credentialScope}\n${crypto.SHA256(canonicalRequest).toString(crypto.enc.Hex)}`;

    const kDate = crypto.HmacSHA256(dateStamp.slice(0, 8), 'AWS4' + secretKey);
    const kRegion = crypto.HmacSHA256(region, kDate);
    const kService = crypto.HmacSHA256(service, kRegion);
    const kSigning = crypto.HmacSHA256('aws4_request', kService);
    const signature = crypto.HmacSHA256(stringToSign, kSigning).toString(crypto.enc.Hex);

    let finalQuerystring = `${canonicalQuerystring}&X-Amz-Signature=${signature}`;
    if (sessionToken) {
      finalQuerystring += `&X-Amz-Security-Token=${encodeURIComponent(sessionToken)}`;
    }

    return `wss://${host}${canonicalUri}?${finalQuerystring}`;
  }
};

export default SigV4Utils;
