import { describe, expect, it } from 'vitest';
import { firstRussianMeaning } from '../src/bot/define.js';

const SAMPLE_EXTRACT = `Русский


Морфологические и синтаксические свойства
дос-ка́
Существительное, неодушевлённое, женский род.


Произношение
МФА: [dɐˈska]


Семантические свойства


Значение
плоский длинный кусок дерева, пиломатериал ◆ Пример с доско́й. И. А. Ефремов
крупная пластина или плита из твёрдого материала ◆ Ещё пример.


Синонимы
пластина


Антонимы
—`;

describe('firstRussianMeaning', () => {
  it('takes the first meaning and strips the examples', () => {
    expect(firstRussianMeaning(SAMPLE_EXTRACT)).toBe('плоский длинный кусок дерева, пиломатериал');
  });

  it('returns null without a Значение section', () => {
    expect(firstRussianMeaning('Русский\n\nПроизношение\nчто-то')).toBeNull();
  });

  it('skips placeholder meanings and stops at the next section', () => {
    expect(firstRussianMeaning('Значение\n?\nСинонимы\nреальное слово')).toBeNull();
    expect(firstRussianMeaning('Значение\n?\nнастоящее значение ◆ пример\nСинонимы')).toBe('настоящее значение');
  });
});
