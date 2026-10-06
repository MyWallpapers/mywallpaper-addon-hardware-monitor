// Static catalogue artwork uses the production thumbnail lifecycle, without native collection.
import { mount } from './main'
import { createPreviewContext } from './preview-host'
const root = document.querySelector<HTMLElement>('#thumbnail')!
const cleanup = mount(createPreviewContext(root, 'bars', () => { throw new Error('No native collection in thumbnail mode') }, 'thumbnail'))
window.addEventListener('pagehide', cleanup, { once: true })
