import en from './booking.en.json'
import fil from './booking.fil.json'
import i18n from './i18n'

/** Booking text arrives with the pages that use it, so it stays out of the first download. Import this from those pages. */
i18n.addResourceBundle('en', 'translation', en, true, true)
i18n.addResourceBundle('fil', 'translation', fil, true, true)
