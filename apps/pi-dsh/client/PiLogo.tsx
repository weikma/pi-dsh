/** Official Pi pixel mark shared by the sidebar and welcome screen. */
import mark from '../assets/pi-mark.svg'

/** Decorative Pi mark; adjacent localized text names the application.
 * @param props - Rendered width and height in CSS pixels.
 * @returns The bundled official mark.
 */
export function PiLogo({ size }: { size: number }) {
  return <img src={mark} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
