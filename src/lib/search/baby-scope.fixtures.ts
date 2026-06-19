// Labeled keyword fixtures for the baby-scope gate. baby=true must pass isBabyQuery;
// baby=false must be rejected. Add real-world misses here as they are discovered.
export const BABY_KEYWORD_FIXTURES: ReadonlyArray<{ keyword: string; baby: boolean }> = [
  { keyword: 'はいはい', baby: true },
  { keyword: '和光堂 はいはい', baby: true },
  { keyword: 'レーベンスミルク', baby: true },
  { keyword: 'ほほえみ', baby: true },
  { keyword: 'パンパース テープ M', baby: true },
  { keyword: 'メリーズ おしりふき', baby: true },
  { keyword: '哺乳瓶', baby: true },
  { keyword: '離乳食', baby: true },
  { keyword: 'コーヒー', baby: false },
  { keyword: 'ノートパソコン', baby: false },
  { keyword: '日本酒', baby: false },
  { keyword: '出産内祝い コーヒー', baby: false },
]
