const rl = require('readline');
const jimp = require('jimp');
const argv = require('minimist')(process.argv.slice(2));

const { IMAGES_FOLDER, DELETE_ANSWERS } = require('./constants');

// ---

const DIFF_PERCENT = typeof argv.d === 'number' ? parseFloat(argv.d) : 0.1;

module.exports.compareImages = compareImages = async (imagePath1, file2) => {
  let image1;
  let image2;

  try {
    image1 = await jimp.read(imagePath1);
    image2 = file2 instanceof jimp
      ? file2
      : await jimp.read(file2);
  }
  catch (err) {
    throw err;
  }

  const hash1 = image1.hash();
  const hash2 = image2.hash();

  const distance = jimp.distance(image1, image2);
  const diff = jimp.diff(image1, image2);

  return !(hash1 !== hash2 || distance > DIFF_PERCENT || diff.percent > DIFF_PERCENT);
};

module.exports.compareCycle = async (files, bar) => {
  const checkedFiles = new Set();
  const similarImages = new Map();

  for (let i = 0; i < files.length; i++) {
    bar.update(i + 1);
    const filePath = files[i];

    const addedFiles = new Set();

    for (const checkedFile of checkedFiles) {
      let imagesAreSame;

      try {
        imagesAreSame = await compareImages(filePath, checkedFile);
      }
      catch (err) {
        console.error(`Не получилось сравнить картинки ${filePath} и ${checkedFile}`);
        console.error('err', err);
        continue;
      }

      if (imagesAreSame) {
        const oldValues = similarImages.get(checkedFile) || [];

        similarImages.set(checkedFile, [...oldValues, filePath]);
        addedFiles.add(filePath);
        break;
      }
    }

    if (!addedFiles.has(filePath)) {
      checkedFiles.add(filePath);
    }
  }

  return {
    similarImages,
    checkedFiles,
  };
};

module.exports.splitArrayToChunks = (array, chunkSize) => {
  const chunkLength = Math.max(array.length / chunkSize, 1);
  const chunks = [];

  for (let i = 0; i < chunkSize; i++) {
    const chunkPosition = chunkLength * (i + 1);

    if (chunkPosition <= array.length) {
      chunks.push(array.slice(chunkLength * i, chunkPosition));
    }
  }

  return chunks;
};

module.exports.createDeleteImagesQuesting = (callback) => {
  const readline = rl.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return function deleteImagesQuesting() {
    readline.question(`Выберите вариант (1/2): `, (answer) => {
      if (answer === DELETE_ANSWERS.duplicates || answer === DELETE_ANSWERS.all) {
        callback(answer);
        return readline.close();
      }

      deleteImagesQuesting();
    });
  }
};

module.exports.correctImagesPath = (imagesPath, folder = IMAGES_FOLDER) => {
  return imagesPath.replace(`${folder}/`, '');
};

module.exports.decliningTitle = (imageLength) => {
  const titles = [
    `Была найдена ${imageLength} картинка, которая имеет дубликаты.`,
    `Было найдено ${imageLength} картинки, которые имеют дубликаты.`,
    `Было найдено ${imageLength} картинок, которые имеют дубликаты.`,
  ];

  const value = Math.abs(imageLength) % 100;
  const num = value % 10;

  if (value > 10 && value < 20) {
    return titles[2];
  }
  if (num > 1 && num < 5) {
    return titles[1];
  }

  if (num === 1) {
    return titles[0];
  }

  return titles[2];
};
