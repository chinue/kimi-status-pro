export type Locale = 'en' | 'zh-CN';

export const dict: Record<Locale, Record<string, string>> = {
  en: {
    'tooltip.title': 'Kimi Code Usage',
    'tooltip.notLoggedIn': 'Sign in to see your usage data.\nRun "KimiStatusPro: Sign In" or set an API key.',
    'tooltip.authFailed': 'Authentication failed. Please sign in again.',
    'tooltip.window5h': '5h window',
    'tooltip.window7d': '7d window',
    'tooltip.resetsIn': 'resets in',
    'tooltip.table.col.used': 'Used',
    'tooltip.table.col.limit': 'Limit',
    'tooltip.table.col.remaining': 'Remaining',
    'tooltip.lastUpdate': 'Last updated:',
    'tooltip.nextUpdate': 'Next update:',
    'tooltip.stale': '(stale)',
    'tooltip.live': '(live)',
    'dashboard.title': 'Kimi Code Usage',
    'dashboard.refresh': '\u21bb Refresh',
    'dashboard.toggleMode': '$ / %',
    'dashboard.currentUsage': 'Current Usage',
    'dashboard.pricingSettings': 'Pricing & Settings',
    'dashboard.apiEnabled': 'API enabled',
    'dashboard.apiDisabled': 'API disabled',
  },
  'zh-CN': {
    'tooltip.title': 'Kimi Code \u7528\u91cf',
    'tooltip.notLoggedIn': '\u8bf7\u767b\u5f55\u540e\u67e5\u770b\u7528\u91cf\u6570\u636e\u3002\n\u8fd0\u884c "KimiStatusPro: Sign In" \u6216\u8bbe\u7f6e API Key\u3002',
    'tooltip.authFailed': '\u8ba4\u8bc1\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
    'tooltip.window5h': '5h \u7a97\u53e3',
    'tooltip.window7d': '7d \u7a97\u53e3',
    'tooltip.resetsIn': '\u91cd\u7f6e\u4e8e',
    'tooltip.table.col.used': '\u5df2\u7528',
    'tooltip.table.col.limit': '\u4e0a\u9650',
    'tooltip.table.col.remaining': '\u5269\u4f59',
    'tooltip.lastUpdate': '\u6700\u540e\u66f4\u65b0\uff1a',
    'tooltip.nextUpdate': '\u4e0b\u6b21\u66f4\u65b0\uff1a',
    'tooltip.stale': '\uff08\u8fc7\u671f\uff09',
    'tooltip.live': '\uff08\u5b9e\u65f6\uff09',
    'dashboard.title': 'Kimi Code \u7528\u91cf',
    'dashboard.refresh': '\u21bb \u5237\u65b0',
    'dashboard.toggleMode': '$ / %',
    'dashboard.currentUsage': '\u5f53\u524d\u7528\u91cf',
    'dashboard.pricingSettings': '\u5b9a\u4ef7\u4e0e\u8bbe\u7f6e',
    'dashboard.apiEnabled': 'API \u5df2\u542f\u7528',
    'dashboard.apiDisabled': 'API \u5df2\u7981\u7528',
  },
};

export function makeT(locale: Locale) {
  return (key: string, ...params: Array<string | number>): string => {
    let template = dict[locale]?.[key] ?? dict['en']?.[key] ?? key;
    params.forEach((p, i) => {
      template = template.replace(`{${i}}`, String(p));
    });
    return template;
  };
}
