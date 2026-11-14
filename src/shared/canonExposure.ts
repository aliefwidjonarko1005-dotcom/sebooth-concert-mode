import { ExposurePreset } from './types'

// EDSDK codes for kEdsPropID_ISOSpeed / kEdsPropID_Tv in 1/3-stop steps
export const CANON_ISO: Record<string, number> = {
    '100': 0x48, '125': 0x4b, '160': 0x4d, '200': 0x50, '250': 0x53, '320': 0x55,
    '400': 0x58, '500': 0x5b, '640': 0x5d, '800': 0x60, '1000': 0x63, '1250': 0x65,
    '1600': 0x68, '2000': 0x6b, '2500': 0x6d, '3200': 0x70, '4000': 0x73, '5000': 0x75,
    '6400': 0x78, '8000': 0x7b, '10000': 0x7d, '12800': 0x80, '16000': 0x83, '20000': 0x85, '25600': 0x88
}

export const CANON_SHUTTER: Record<string, number> = {
    '1/30': 0x60, '1/40': 0x63, '1/50': 0x65, '1/60': 0x68, '1/80': 0x6b, '1/100': 0x6d,
    '1/125': 0x70, '1/160': 0x73, '1/200': 0x75, '1/250': 0x78, '1/320': 0x7b, '1/400': 0x7d,
    '1/500': 0x80, '1/640': 0x83, '1/800': 0x85, '1/1000': 0x88, '1/1250': 0x8b, '1/1600': 0x8d,
    '1/2000': 0x90, '1/2500': 0x93, '1/3200': 0x95, '1/4000': 0x98
}

// indoor: measured on the booth backdrop without flash at f/6.3. outdoor: starting point for daylight at f/6.3.
export const DEFAULT_EXPOSURE_PRESETS: Record<'indoor' | 'outdoor', ExposurePreset> = {
    indoor: { iso: '3200', shutter: '1/100' },
    outdoor: { iso: '200', shutter: '1/1000' }
}
