import { describe, expect, it } from 'vitest'
import { displayArtistName, displaySongTitle } from './format-song'

describe('displaySongTitle / displayArtistName', () => {
  it('keeps names that are already written for people', () => {
    const song = { title: "Knockin' On Heaven's Door", artist: 'AC/DC', song_name: 'ac_dc/knockin_on_heavens_door' }
    expect(displaySongTitle(song)).toBe("Knockin' On Heaven's Door")
    expect(displayArtistName(song)).toBe('AC/DC')
  })

  it('title-cases lowercase or snake_case names from their slug', () => {
    const song = { title: 'trollz', artist: '6ix9ine_nicki_minaj', song_name: '6ix9ine_nicki_minaj/trollz' }
    expect(displaySongTitle(song)).toBe('Trollz')
    expect(displayArtistName(song)).toBe('6ix9ine Nicki Minaj')
  })

  it('title-cases single-word slugs', () => {
    expect(displayArtistName({ artist: 'rem', song_name: 'rem/losing_my_religion' })).toBe('Rem')
  })

  it('keeps Hebrew names as they are', () => {
    const song = { title: 'הזמן האחרון', artist: 'הביליוים', song_name: 'habiluim/הזמן_האחרון' }
    expect(displaySongTitle(song)).toBe('הזמן האחרון')
    expect(displayArtistName(song)).toBe('הביליוים')
  })
})
