const express = require("express");
const { authenticate, executeRules } = require('./inbox');
const { error } = require("console");
const app = express();

//authenticate()//authenticate and fetch the mail
executeRules();//apply a rule


app.listen(5500, () => {
  console.log("port on 5500");
});
