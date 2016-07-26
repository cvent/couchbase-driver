(cat intro.md > readme.hbs) && (cat intro.md > template.md) && (echo "\n\n## License\n\nCopyright 2016 Bojan D.\n\nLicensed under the MIT License." 1>> template.md) && (echo "\n## API Reference\n\n{{>all-docs~}}\n\n## License\n\nCopyright 2016 Bojan D.\n\nLicensed under the MIT License." 1>> readme.hbs) && (jsdoc2md "lib/**/*.js" --heading-depth 3 --template readme.hbs > README.md) && (rm readme.hbs) && (jsdoc -c jsdoc.json -R template.md) && (rm template.md)

for f in docs/*.html
do
  ./replace $f
done
