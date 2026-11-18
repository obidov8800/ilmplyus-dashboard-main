import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUzbekText, normalizeUzbekFields } from './uzbekTypography.ts';

test('canonical Uzbek marks for keyboard and pasted variants', () => {
  for (const mark of ["'", '`', '‘', '’', 'ʻ', 'ʼ', 'ʹ', '´']) {
    assert.equal(normalizeUzbekText(`O${mark}zbek g${mark}oya ma${mark}muriy san${mark}at`), 'O‘zbek g‘oya ma’muriy san’at');
  }
  assert.equal(normalizeUzbekText("o' g' O' G'"), 'o‘ g‘ O‘ G‘');
  assert.equal(normalizeUzbekText('‘‘matn’’ “matn” "matn"'), '‘‘matn’’ ‘‘matn’’ ‘‘matn’’');
  const canonical = 'O‘g‘il, ma’muriy, ma’no';
  assert.equal(normalizeUzbekText(canonical), canonical);
});

test('paired quotes use two marks without inner padding or repeated changes', () => {
  const expected = '‘‘O‘zbek tili’’ va ‘‘ma’muriy bo‘lim’’';
  assert.equal(normalizeUzbekText('"O\'zbek tili" va “ma\'muriy bo\'lim”'), expected);
  assert.equal(normalizeUzbekText(expected), expected);
  assert.equal(normalizeUzbekText('‘‘   matn   ’’'), '‘‘matn’’');
  assert.equal(normalizeUzbekText('12" ekran, "ochiq'), '12" ekran, "ochiq');
  assert.equal(normalizeUzbekText('"ochiq'), '"ochiq');
  assert.equal(normalizeUzbekText('<span title="matn">"matn"</span>'), '<span title="matn">‘‘matn’’</span>');
});

test('option labels lose quote padding while values and word spacing are preserved', () => {
  const options = [{ value: '‘‘ eski qiymat ’’', label: '‘‘ Asosiy filial ’’' },
    { value: '2', label: '" O\'zbek tili " kursi' }];
  assert.deepEqual(normalizeUzbekFields(options), [
    { value: '‘‘ eski qiymat ’’', label: '‘‘Asosiy filial’’' },
    { value: '2', label: '‘‘O‘zbek tili’’ kursi' },
  ]);
});

test('human text is normalized without changing technical fields or original objects', () => {
  const original = { name: "O'zbek", password: "o'g'", username: "g'oya", token: "o'", url: "https://example.com/o'g'", data: [{ full_name: "G'ani", description: "Ma'muriy" }] };
  const result = normalizeUzbekFields(original);
  assert.equal(result.name, 'O‘zbek');
  assert.equal(result.data[0].full_name, 'G‘ani');
  assert.equal(result.data[0].description, 'Ma’muriy');
  for (const key of ['password', 'username', 'token', 'url']) assert.equal(result[key], original[key]);
  assert.equal(original.name, "O'zbek");
  assert.equal(normalizeUzbekText("https://example.com/o'g' o'@example.com C:\\o'zbek"), "https://example.com/o'g' o'@example.com C:\\o'zbek");
});

test('multipart text is normalized while files and credentials remain unchanged', () => {
  const data = new FormData();
  data.append('students[0][full_name]', "G'ani");
  data.append('password', "g'ani");
  const file = new File(['original bytes'], "o'quvchi.txt");
  data.append('file', file);
  const result = normalizeUzbekFields(data);
  assert.equal(result.get('students[0][full_name]'), 'G‘ani');
  assert.equal(result.get('password'), "g'ani");
  assert.equal(result.get('file'), file);
  assert.equal(data.get('students[0][full_name]'), "G'ani");
});
