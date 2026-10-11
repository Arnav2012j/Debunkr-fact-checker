import type { Lang } from '@/settings/settings-store';

/** BCP-47 tags used for both speech recognition and synthesis. */
export const SPEECH_LANG: Record<Lang, string> = { English: 'en-IN', Hindi: 'hi-IN', Spanish: 'es-ES', French: 'fr-FR' };
