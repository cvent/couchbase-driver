(jsdoc -c jsdoc.json -R intro.md) && (cat intro.md > readme.hbs) && (echo "\n## API Reference\n\n{{>all-docs~}}" 1>> readme.hbs) && (jsdoc2md "lib/**/*.js" --heading-depth 3 --template readme.hbs > README.md) && (rm readme.hbs)

for f in docs/*.html
do
  ./replace $f
done
