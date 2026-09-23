JavaScript
import { registerAdapter, resolve } from './adapter-registry.js';

const SERVICES = Object.freeze({
  youtube: Object.freeze({
    serviceId: 'youtube',
    adapterId: 'youtube-portal',
    adapterVersion: '1.0.0',
    capabilities: Object.freeze(['resolve-session']),
    securityClass: 'trusted-agent-boundary',
    entryUrl: 'https://www.youtube.com',
    label: 'YouTube'
  }),
  netflix: Object.freeze({
    serviceId: 'netflix',
    adapterId: 'netflix-portal',
    adapterVersion: '1.0.0',
    capabilities: Object.freeze(['resolve-session']),
    securityClass: 'trusted-agent-boundary',
    entryUrl: 'https://www.netflix.com',
    label: 'Netflix'
  }),
  google: Object.freeze({
    serviceId: 'google',
    adapterId: 'google-portal',
    adapterVersion: '1.0.0',
    capabilities: Object.freeze(['resolve-session']),
    securityClass: 'trusted-agent-boundary',
    entryUrl: 'https://www.google.com',
    label: 'Google'
  }),
  icloud: Object.freeze({
    serviceId: 'icloud',
    adapterId: 'icloud-portal',
    adapterVersion: '1.0.0',
    capabilities: Object.freeze(['resolve-session']),
    securityClass: 'trusted-agent-boundary',
    entryUrl: 'https://www.icloud.com',
    label: 'iCloud'
  })
});

function assertValidHandle(handle, serviceId) {
  if (
    handle === null ||
    typeof handle !== 'object' ||
    typeof handle.handleId !== 'string' ||
    handle.handleId.length === 0 ||
    handle.serviceId !== serviceId
  ) {
    throw new TypeError(`invalid ${serviceId} portal handle`);
  }
}

function createAdapter(config) {
  const registration = registerAdapter({
    serviceId: config.serviceId,
    adapterId: config.adapterId,
    adapterVersion: config.adapterVersion,
    capabilities: config.capabilities,
    securityClass: config.securityClass
  });

  return Object.freeze({
    ...registration,
    adapterVersion: config.adapterVersion,
    securityClass: config.securityClass,

    open(handle) {
      assertValidHandle(handle, config.serviceId);
      return Object.freeze({
        serviceId: config.serviceId,
        handleId: handle.handleId,
        entryUrl: config.entryUrl,
        label: config.label
      });
    },

    close(handle) {
      assertValidHandle(handle, config.serviceId);
      return Object.freeze({
        serviceId: config.serviceId,
        handleId: handle.handleId,
        closed: true
      });
    }
  });
}

for (const config of Object.values(SERVICES)) {
  createAdapter(config);
}

export function getAdapter(serviceId) {
  const registration = resolve(serviceId);
  if (!registration) return undefined;

  const config = SERVICES[serviceId];
  if (!config) return undefined;

  return Object.freeze({
    ...registration,
    adapterVersion: config.adapterVersion,
    securityClass: config.securityClass,

    open(handle) {
      assertValidHandle(handle, serviceId);
      return Object.freeze({
        serviceId,
        handleId: handle.handleId,
        entryUrl: config.entryUrl,
        label: config.label
      });
    },

    close(handle) {
      assertValidHandle(handle, serviceId);
      return Object.freeze({
        serviceId,
        handleId: handle.handleId,
        closed: true
      });
    }
  });
}