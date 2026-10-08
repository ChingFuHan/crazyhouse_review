import { describe, expect, it } from 'vitest'
import { ratingPoints, ratingScale } from './ratingGraph'

describe('rating graph', () => {
  it('rounds the scale to clean ticks with air above and below', () => {
    expect(ratingScale([1500, 1436, 1520])).toEqual({ min: 1400, max: 1550, ticks: [1400, 1450, 1500, 1550] })
    expect(ratingScale([1500])).toEqual({ min: 1450, max: 1550, ticks: [1450, 1500, 1550] })
    expect(ratingScale([1200, 1700]).ticks).toEqual([1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800])
  })

  it('spreads the attempts over the width, the start first', () => {
    const scale = ratingScale([1500, 1550, 1450])
    const points = ratingPoints(1500, [1550, 1450], 200, 100, scale)
    expect(points.map((p) => [p.x, p.attempt])).toEqual([[0, -1], [100, 0], [200, 1]])
    expect(points[1].y).toBeLessThan(points[0].y) // higher rating, higher on screen
    expect(ratingPoints(1500, [], 200, 100, scale)).toHaveLength(1)
  })
})
