/** an answer amount, in the `{{value CUR}}` tag the chat renderer formats */
export function usd(value: number): string {
  const text = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  return `{{${value < 0 ? '-' : ''}${text} USD}}`
}
