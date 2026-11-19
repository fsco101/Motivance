import en from './exercise.en.json'
import fil from './exercise.fil.json'
import i18n from './i18n'

/** Camera exercise text arrives with the camera pages, so it stays out of the first download. Import this from those pages. */
i18n.addResourceBundle('en', 'translation', en, true, true)
i18n.addResourceBundle('fil', 'translation', fil, true, true)
