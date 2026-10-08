// Geometry of the rating chart on the puzzle history tab: one point per rated attempt (plus the
// starting rating), oldest first, on a y scale rounded to clean ticks.

export interface RatingPoint {
  x: number
  y: number
  rating: number
  /** Index into the attempts (oldest first); -1 for the start. */
  attempt: number
}

export interface RatingScale {
  min: number
  max: number
  ticks: number[]
}

/** A clean range around the ratings: ticks every 50 / 100 / 200, at least one step of air. */
export function ratingScale(ratings: number[]): RatingScale {
  const low = Math.min(...ratings)
  const high = Math.max(...ratings)
  const step = high - low > 600 ? 200 : high - low > 200 ? 100 : 50
  const min = Math.floor(low / step) * step - (low % step === 0 ? step : 0)
  const max = Math.ceil(high / step) * step + (high % step === 0 ? step : 0)
  const ticks: number[] = []
  for (let tick = min; tick <= max; tick += step) ticks.push(tick)
  return { min, max, ticks }
}

/** `afters`: the rating after each attempt, oldest first; `start`: the rating before the first. */
export function ratingPoints(start: number, afters: number[], width: number, height: number, scale: RatingScale): RatingPoint[] {
  const ratings = [start, ...afters]
  const span = Math.max(1, ratings.length - 1)
  const y = (rating: number) => height - ((rating - scale.min) / (scale.max - scale.min)) * height
  return ratings.map((rating, i) => ({ x: (i / span) * width, y: y(rating), rating, attempt: i - 1 }))
}
