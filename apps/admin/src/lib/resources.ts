import { Permission } from '@kode/contracts';
import type { ResourceDefinition } from './cms-api';

/**
 * The CMS content catalogue.
 *
 * Labels are explicit rather than derived. The draft built them with
 * `section.slice(0, -1)`, which produced "NEW NEW", "NEW POLICIE" and a panel
 * headed "medi".
 */
export const RESOURCES: Record<string, ResourceDefinition> = {
  news: {
    key: 'news',
    path: '/cms/news',
    singular: 'news story',
    plural: 'News',
    icon: 'news',
    permissions: {
      read: Permission.NEWS_READ,
      create: Permission.NEWS_CREATE,
      update: Permission.NEWS_UPDATE,
      remove: Permission.NEWS_DELETE,
      publish: Permission.NEWS_PUBLISH,
    },
  },
  events: {
    key: 'events',
    path: '/cms/events',
    singular: 'event',
    plural: 'Events',
    icon: 'calendar',
    permissions: {
      read: Permission.EVENT_READ,
      create: Permission.EVENT_CREATE,
      update: Permission.EVENT_UPDATE,
      remove: Permission.EVENT_DELETE,
      publish: Permission.EVENT_PUBLISH,
    },
  },
  policies: {
    key: 'policies',
    path: '/cms/policies',
    singular: 'policy',
    plural: 'Policies',
    icon: 'shield',
    permissions: {
      read: Permission.POLICY_READ,
      create: Permission.POLICY_CREATE,
      update: Permission.POLICY_UPDATE,
      remove: Permission.POLICY_DELETE,
      publish: Permission.POLICY_PUBLISH,
    },
  },
  faqs: {
    key: 'faqs',
    path: '/cms/faqs',
    singular: 'FAQ',
    plural: 'FAQs',
    icon: 'question',
    permissions: {
      read: Permission.FAQ_READ,
      create: Permission.FAQ_CREATE,
      update: Permission.FAQ_UPDATE,
      remove: Permission.FAQ_DELETE,
      publish: Permission.FAQ_PUBLISH,
    },
  },
  gallery: {
    key: 'gallery',
    path: '/cms/gallery',
    singular: 'album',
    plural: 'Gallery',
    icon: 'image',
    permissions: {
      read: Permission.GALLERY_READ,
      create: Permission.GALLERY_CREATE,
      update: Permission.GALLERY_UPDATE,
      remove: Permission.GALLERY_DELETE,
      publish: Permission.GALLERY_PUBLISH,
    },
  },
};

export function resourceFor(key: string | undefined): ResourceDefinition | undefined {
  return key ? RESOURCES[key] : undefined;
}
