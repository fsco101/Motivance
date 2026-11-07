import en from './landing.en.json'
import fil from './landing.fil.json'
import i18n from './i18n'

/** The public pages' text arrives with them, so it stays out of what every signed-in person downloads. Import this from those pages. */
i18n.addResourceBundle('en', 'translation', en, true, true)
i18n.addResourceBundle('fil', 'translation', fil, true, true)
