const path = require('path');
const fse = require('fs-extra');
const glob = require('glob');
const jimp = require('jimp');

const cliProgress = require('cli-progress');
const argv = require('minimist')(process.argv.slice(2));

// ---

const {
  correctImagesPath,
  decliningTitle,
  splitArrayToChunks,
  compareImages,
  compareCycle,
} = require('./src/utils');
const {
  IMAGES_FOLDER,
  RESULT_FOLDER,
  DEFAULT_BAR_VALUE,
  DEFAULT_NUMBER_OF_STREAMS,
} = require('./src/constants');

// ---

const NUMBER_OF_STREAMS = argv.s || DEFAULT_NUMBER_OF_STREAMS;

glob(`${IMAGES_FOLDER}/**/*`, { nodir: true }, (err, files) => {
  if (err) {
    console.error(`Не удалось прочитать файлы из папки ${IMAGES_FOLDER}`);
    console.error('err', err);
    return null;
  }

  glob(`${IMAGES_FOLDER}2/**/*`, { nodir: true }, async (comparisonImagesErr, comparisonImages) => {
    if (err) {
      console.error(`Не удалось прочитать файлы из папки ${IMAGES_FOLDER}2`);
      console.error('err', comparisonImagesErr);
      return null;
    }

    try {
      console.log(`Создаю папку ${RESULT_FOLDER}...`);
      await fse.remove(path.join(__dirname, RESULT_FOLDER));
      await fse.ensureDir(path.join(__dirname, RESULT_FOLDER));
    }
    catch (err) {
      console.error(`Не удалось создать папку ${RESULT_FOLDER}`);
      console.error('err', err);
      return null;
    }

    let similarImages;

    const hasComparisonImages = comparisonImages.length > 0;
    if (hasComparisonImages) {
      similarImages = await compareSpecificImages(files, comparisonImages);
    }
    else {
      similarImages = await compareEachOther(files);
    }

    let index = 0;
    similarImages.forEach((duplicates, original) => {
      if (!hasComparisonImages) {
        const correctOriginal = correctImagesPath(original);

        const currentOriginalPath = path.join(__dirname, original);
        const finalOriginalPath = path.join(__dirname, RESULT_FOLDER, `${index}___${correctOriginal}`);

        fse.copy(currentOriginalPath, finalOriginalPath).catch((err) => {
          console.error(`Не удалось скопировать ${currentOriginalPath} в ${finalOriginalPath}`);
          console.error('err', err);
        });
      }

      duplicates.forEach((duplicate) => {
        const correctDuplicate = correctImagesPath(duplicate);
        const currentDuplicatePath = path.join(__dirname, duplicate);
        const finalDuplicatePath = path.join(__dirname, RESULT_FOLDER, `${index}___${correctDuplicate}`);

        fse.copy(currentDuplicatePath, finalDuplicatePath).catch((err) => {
          console.error(`Не удалось скопировать ${currentDuplicatePath} в ${finalDuplicatePath}`);
          console.error('err', err);
        });
      });

      index++;
    });

    try {
      const metaJsonPath = path.join(__dirname, 'meta.json');

      await fse.writeJson(metaJsonPath, JSON.stringify({
        hasComparisonImages,
        images: Object.fromEntries(similarImages),
      }));
    } catch (err) {
      console.error('Не получилось сохранить meta.json файл');
      console.error('err', err);
      return;
    }

    console.log(decliningTitle(similarImages.size));
    console.log(`Зайдите в папку ${RESULT_FOLDER} и проверьте правильность найденных дубликатов.`);
    console.log('Если какие-то дубликаты определились неправильно - удалите их вручную.');
    console.log('Если все верно, тогда запустите следующий скрипт на удаление.');
    console.log('Чтобы запустить, напишите: npm run delete');
  });
});

async function compareEachOther(files) {
  const multiBar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true
  }, cliProgress.Presets.shades_grey);

  const chunks = splitArrayToChunks(files, NUMBER_OF_STREAMS);

  const promises = chunks.map((chunk) => {
    const bar = multiBar.create(chunk.length, DEFAULT_BAR_VALUE);

    return compareCycle(chunk, bar);
  });

  console.log('Начинаю сканировать картинки...');

  const [first, ...other] = await Promise.all(promises);

  const { checkedFiles, similarImages } = other.reduce((acc, value) => {

    acc.checkedFiles = new Set([...acc.checkedFiles, ...value.checkedFiles]);
    acc.similarImages = new Map([...acc.similarImages, ...value.similarImages]);

    return acc;
  }, {
    checkedFiles: new Set(),
    similarImages: first.similarImages,
  });

  console.log('\n\nФинальное сканирование...');

  const lastBar = multiBar.create(first.checkedFiles.size, DEFAULT_BAR_VALUE);

  let barProgress = 0;
  for (const fileOfFirstChecked of first.checkedFiles) {
    barProgress++;
    lastBar.update(barProgress);

    for (const fileOfOtherChecked of checkedFiles) {
      let imagesAreSame;

      try {
        imagesAreSame = await compareImages(fileOfFirstChecked, fileOfOtherChecked);
      }
      catch (err) {
        console.error(`Не получилось сравнить картинки ${fileOfFirstChecked} и ${fileOfOtherChecked}`);
        console.error('err', err);
        continue;
      }

      if (imagesAreSame) {
        if (similarImages.has(fileOfOtherChecked)) {
          const prevValue = first.similarImages.get(fileOfFirstChecked) || [];
          const nextValue = similarImages.get(fileOfOtherChecked);

          if (nextValue) {
            similarImages.delete(fileOfOtherChecked);
          }

          similarImages.set(fileOfFirstChecked, [...prevValue, fileOfOtherChecked, ...(nextValue || [])]);

          checkedFiles.delete(fileOfOtherChecked);
        }
      }
    }
  }

  multiBar.stop();

  return similarImages;
}

async function compareSpecificImages(files, comparisonFiles) {
  const similarImages = new Map();

  const promises = comparisonFiles.map((comparisonFile) => (
    new Promise(async (res, rej) => {
      try {
        const file = await jimp.read(comparisonFile);

        res({ file, path: comparisonFile });
      }
      catch (err) {
        rej(err);
      }
    })
  ));

  console.log('Начинаю сканировать картинки...');
  
  const comparisonImages = await Promise.all(promises);

  const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_grey);
  bar.start(files.length, DEFAULT_BAR_VALUE);

  // TODO: Сделать асинхронное сравнение сразу нескольких картинок одновременно
  let index = 0;
  for (const file of files) {
    index++;
    bar.update(index);

    for (const comparisonImage of comparisonImages) {
      const imagesAreSame = await compareImages(file, comparisonImage.file);

      if (imagesAreSame) {
        const prevValue = similarImages.get(comparisonImage.path) || [];

        similarImages.set(comparisonImage.path, [...prevValue, file]);
        break;
      }
    }
  }

  bar.stop();

  return similarImages;
}
