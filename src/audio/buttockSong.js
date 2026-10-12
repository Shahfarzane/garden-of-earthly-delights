// The melody written on the sinner's buttocks under the giant lute in Hell.
//
// Transcription read from the full-resolution scan: note heads detected and
// mapped against fitted staff lines, assuming a C clef on the second line
// from the bottom (the same assumption as Amelia Hamrick's 2014 reading).
// Three staves, read top to bottom, left to right; the third staff is cut off
// by the body's curve. Pitches are approximate and the notation may be
// symbolic rather than real music. All black semiminims: 1 beat each, the
// last note of each staff held 2 beats, then a 1-beat rest. Staff 2 leaps
// F to B repeatedly (a tritone); it is left as read, not corrected to B-flat.
// midi values are already in the sung octave.

const STAVES = [
  [57, 59, 64, 64, 60, 57, 57, 57, 62, 65, 64, 60, 57],
  [65, 72, 65, 71, 65, 71, 72, 74, 71, 67, 64, 69, 62, 71, 72, 74, 72, 71, 65, 74],
  [57, 57, 60, 59, 57, 57, 57, 57],
];

function staffNotes(staff) {
  const out = staff.map((midi, i) => ({ midi, beats: i === staff.length - 1 ? 2 : 1 }));
  out.push({ midi: null, beats: 1 }); // rest between staves
  return out;
}

export const BUTTOCK_SONG = {
  tempo: 72,
  mode: 'dorian',
  notes: STAVES.flatMap(staffNotes),
};
