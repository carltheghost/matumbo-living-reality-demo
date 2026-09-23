const adapters = new Map();

function validString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function registerAdapter({
  serviceId,
  adapterId,
  adapterVersion,
  capabilities,
  securityClass
}) {
  if (![serviceId, adapterId, adapterVersion, securityClass].every(validString)) {
    throw new TypeError('serviceId, adapterId, adapterVersion, and securityClass are required');
  }
  if (!Array.isArray(capabilities) ||
      capabilities.length === 0 ||
      capabilities.some((value) => !validString(value))) {
    throw new TypeError('capabilities must be a non-empty array of strings');
  }
  if (adapters.has(serviceId)) {
    throw new Error(`adapter already registered for service: ${serviceId}`);
  }

  const record = Object.freeze({
    serviceId,
    adapterId,
    adapterVersion,
    capabilities: Object.freeze([...capabilities]),
    securityClass
  });
  adapters.set(serviceId, record);
  return Object.freeze({
    serviceId,
    adapterId,
    capabilities: Object.freeze([...capabilities])
  });
}

export function resolve(serviceId) {
  if (!validString(serviceId)) throw new TypeError('serviceId must be a non-empty string');
  const record = adapters.get(serviceId);
  if (!record) return undefined;
  return Object.freeze({
    serviceId: record.serviceId,
    adapterId: record.adapterId,
    capabilities: Object.freeze([...record.capabilities])
  });
}
