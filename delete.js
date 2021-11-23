const path = require('path');
const fse = require('fs-extra');
const glob = require('glob');

const {
  RESULT_FOLDER,
  DELETE_ANSWERS,
} = require('./src/constants');

const {
  correctImagesPath,
  createDeleteImagesQuesting,
} = require('./src/utils');

// ---

const REG_EXP = /\d*___/;

// ---

fse.readJson(path.join(__dirname, 'meta.json'), async (err, json) => {
  if (err) {
    console.error('Не получилось прочитать meta.json файл');
    console.error('err', err);
    return;
  }

  const { images, hasComparisonImages } = JSON.parse(json);
  const similarImages = new Map(Object.entries(images));

  glob(`${RESULT_FOLDER}/**/*`, { nodir: true }, async (err, files) => {
    if (err) {
      console.error(`Не удалось прочитать файлы-дубликаты из папки ${RESULT_FOLDER}`);
      console.error('err', err);
      return null;
    }

    const correctedFiles = files.map((file) => correctImagesPath(file, RESULT_FOLDER).replace(REG_EXP, ''));

    if (hasComparisonImages) {
      similarImages.forEach((duplicates) => {
        duplicates.forEach((duplicate) => {
          fse.removeSync(duplicate);
        });
      });
    }
    else {
      console.log('Выберите вариант удаления:');
      console.log('1. Удалить только дубликаты.');
      console.log('2. Удалить дубликаты и оригиналы.');

      createDeleteImagesQuesting((answer) => {
        similarImages.forEach((duplicates, original) => {
          const correctedOriginal = correctImagesPath(original);

          if (!correctedFiles.includes(correctedOriginal)) {
            console.warn('Предупреждение, картинка не найдена (возможно вы её удалили): ', correctedOriginal);
            return;
          }

          // Проверки на DELETE_ANSWERS.duplicates нет, потому что их все равно нужно будет в DELETE_ANSWERS.all удалять
          if (answer === DELETE_ANSWERS.all) {
            fse.removeSync(original);
          }

          duplicates.forEach((duplicate) => {
            fse.removeSync(duplicate);
          });
        });
      })();
    }

    try {
      await fse.remove(path.join(__dirname, RESULT_FOLDER));
      await fse.remove(path.join(__dirname, 'meta.json'));
    }
    catch (err) {
      console.error('Не получилось удалить дополнительные файлы');
      console.error('err', err);
      return null;
    }
  });
});
