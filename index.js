var tokenNodeBB = '0000000000';
var jwtSecret = '0000000000';
var jwt = require('jwt-simple');

var express = require('express');

var cors = require('cors-express');
var app = express();
var options = {};
app.use(cors(options));

var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();

var mysql = require('mysql');
var connection = mysql.createConnection({
  host              : '0000000000',
  user              : '0000000000',
  password          : '0000000000',
  database          : '0000000000',
  multipleStatements: true
});

// Prevent MySQL timeout
setInterval(function () {
  connection.query('SELECT 1');
}, 1000);

var sha1 = require('sha1');

var request = require('request');
var parseString = require('xml2js').parseString;

var parseDate = require('parse-date');

var intersection = require('array-intersection');
var union = require('arr-union');
var unique = require('array-unique');

var sd = require('standard-deviation');

var validator = require("email-validator");

var api_key = 'key-0000000000';
var domain = 'phenotate.org';
var mailgun = require('mailgun-js')({apiKey: api_key, domain: domain});

var maxAdminID = 000; // Users with IDs this or below are considered admin
var hpoUserIDs = [000, 000, 000]; // Users with these IDs only have HPO/OMIM/Orphanet annotations

var costInPhenocashToPrefillAnnotation = 0;
var costInPhenocashToAddAnnotationSlotBase = 0;
var costInPhenocashToAddAnnotationSlotAdditional = 0;
var rewardInPointsForCustomAnnotation = 0;
var rewardInPhenocashForCustomAnnotation = 0;
var rewardInPointsForCustomAnnotationResubmission = 0;
var rewardInPhenocashForCustomAnnotationResubmission = 0;
var signupPoints = 0;
var signupPhenocash = 0;

var minNumAnnotationSlots = 0;
var maxNumAnnotationsPerDiseasePerStudent = 0;

var featuredDiseases = [
  {
    'vocabulary': 'omim',
    'diseaseName': '#000000 SOME DISEASE',
    'rewardInPoints': 0,
    'rewardInPhenocash': 0
  },
  {
    'vocabulary': 'ordo',
    'diseaseName': '%000000 ANOTHER DISEASE',
    'rewardInPoints': 0,
    'rewardInPhenocash': 0
  }
];

function getSystem(annotationID, phenotypeID, res) {
  var query0 = 'SELECT hpo FROM phenotypes WHERE id = ' + phenotypeID + ' AND annotation_id = ' + annotationID + ';';
  var query1 = 'SELECT system FROM phenotypes WHERE system IS NOT NULL AND hpo IN (SELECT hpo FROM phenotypes WHERE id = ' + phenotypeID + ' AND annotation_id = ' + annotationID + ')';
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if (rows[1].length > 0) {
      var query = 'UPDATE phenotypes SET system = ' + connection.escape(rows[1][0].system) + ' WHERE id = ' + phenotypeID + ' AND annotation_id = ' + annotationID;
      connection.query(query);
      requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=' + rows[1][0].system;
      request({
          url: requestURL,
          json: true
        }, function (error, response, body) {
          if (res)
            res.json({ phenotypeID: parseInt(phenotypeID, 10), systemName: body.rows[0].name });
        });
    }
    var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=' + rows[0][0].hpo;
    request({
        url: requestURL,
        json: true
      }, function (error, response, body) {
      if (!error && response.statusCode == 200 && body.rows.length > 0) {
	    var termCategories = body.rows[0].term_category;
	    termCategories.push(body.rows[0].id);
        for (var i = 0; i < termCategories.length; i++) {
          requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=' + termCategories[i];
          request({
              url: requestURL,
              json: true
            }, function (error, response, body) {
              if (!error && response.statusCode == 200 && body.rows.length > 0) {
                var query = 'UPDATE phenotypes SET modifier = 1 WHERE id = ' + phenotypeID + ' AND annotation_id = ' + annotationID + ' AND system IS NULL';
                connection.query(query);
                if (body.rows[0].is_a) {
                  for (var j = 0; j < body.rows[0].is_a.length; j++) {
                    if (body.rows[0].is_a[j].substring(0, 10) == 'HP:0000118') {
                      query = 'UPDATE phenotypes SET system = ' + connection.escape(body.rows[0].id) + ', modifier = 0 WHERE id = ' + phenotypeID + ' AND annotation_id = ' + annotationID + ' AND system IS NULL';
                      connection.query(query);
                      try {
                        res.json({ phenotypeID: parseInt(phenotypeID, 10), systemName: body.rows[0].name });
                      } catch (err) { }
                    }
                  }
                }
              }
            });
        }
      }
    });
  });
}

function updateScores() {
  var points = {};
  var query = 'SELECT user_id, class_id, points FROM transactions WHERE pending = 0 AND points != 0';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    for (var i = 0; i < rows.length; i++) {
      if (points[rows[i].user_id + '|' + rows[i].class_id])
        points[rows[i].user_id + '|' + rows[i].class_id] += rows[i].points;
      else
        points[rows[i].user_id + '|' + rows[i].class_id] = rows[i].points;
    }
    for (var key in points) {
      if (points.hasOwnProperty(key)) {
        splitKey = key.split('|');
        var userID = splitKey[0];
        var classID = splitKey[1];
        query = 'DELETE FROM points WHERE user_id = ' + userID + ' AND class_id = ' + classID + ';';
        var q = 'INSERT INTO points (user_id, class_id, points) VALUES (' + userID + ',' + classID + ',' + points[key] + ')';
        connection.query(query + q);
      }
    }
  });
}

process.on('uncaughtException', function (err) {
  console.error(err);
});

// Used for ensuring uptime (and do some routine tasks while we're at it)
app.get('/check', function (req, res) {
  // Routine task 1: Delete temporarily-published annotations
  var query = 'SELECT id FROM annotations WHERE DATEDIFF(CURDATE(), date_created) > 7 AND status = 3 AND id NOT IN (SELECT compare_to_annotation_id FROM annotations WHERE compare_to_annotation_id IS NOT NULL) AND id NOT IN (SELECT annotation_id FROM shares WHERE annotation_id IS NOT NULL)';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    for (var i = 0; i < rows.length; i++) {
      var query0 = 'DELETE c FROM citations c INNER JOIN refs ON c.ref_id = refs.id WHERE annotation_id = ' + rows[i].id + ';';
      var query1 = 'DELETE FROM refs WHERE annotation_id = ' + rows[i].id + ';';
      var query2 = 'DELETE FROM phenotypes WHERE annotation_id = ' + rows[i].id + ';';
      var query3 = 'DELETE FROM annotations WHERE id = ' + rows[i].id;
      connection.query(query0 + query1 + query2 + query3);
    }
  });
  // Routine task 2: Delete outdated tokens
  var query = 'DELETE FROM tokens WHERE DATEDIFF(CURDATE(), date_created) > 7';
  connection.query(query);
  // Routine task 3: Update scores
  updateScores();
  // Check the number of tokens
  query = 'SELECT COUNT(*) AS count FROM tokens';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length > 0) {
      res.send(rows[0].count + '');
      res.end();
    } else {
      res.sendStatus(403);
    }
  });
});

// Parse JSON and make sure that it's not empty
app.post('*', jsonParser, function (req, res, next) {
  if (!req.body) return res.sendStatus(400);
  next();
});

// OMIM/Orphanet lookup
app.get('/solr/:db/:query', function (req, res, next) {
  if (req.params.db == 'hpo') {
    next();
  } else {
    var noCount = req.params.db.endsWith('-no-count');
    var split = req.params.db.split('-');
    var db = split[0];
  	var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + db + '&q=' + req.params.query;
    request({
        url: requestURL,
        json: true
      }, function (error, response, body) {
      if (!error && response.statusCode == 200 && body.rows.length > 0) {
        var results = [];
        var dbDiseases = [];
        for (var i = 0; i < body.rows.length; i++) {
          if (db == 'ordo') {
            results.push('@' + body.rows[i].id.replace(/[^0-9]/g, '') + ' ' + body.rows[i].name);
          } else if (db == 'omim') {
            results.push((body.rows[i].symbol ? body.rows[i].symbol : '') + body.rows[i].id + ' ' + body.rows[i].name);
          }
          dbDiseases.push(parseInt(body.rows[i].id.replace(/[^0-9]/g, ''), 10));
        }
        var query = 'SELECT id AS diseaseID, db_disease, name, (SELECT COUNT(*) FROM annotations WHERE annotations.disease_id = diseaseID AND status = 2 AND n_of_one = 0) AS quantity FROM diseases WHERE db_disease IN (' + dbDiseases.join() + ') AND db = \'' + db + '\' ORDER BY FIELD (db_disease, ' + dbDiseases.join() + ')';
        connection.query(query, function(err, rows) {
          if (!noCount) {
            if (err) throw err;
            var cursor = 0;
            for (var i = 0; i < results.length; i++) {
              var diseaseNameWords = results[i].replace(/[^a-zA-Z0-9 ]/g, '').split(' ');
              var diseaseID = diseaseNameWords[0];
      	      if (cursor < rows.length && rows[cursor].db_disease == diseaseID && rows[cursor].quantity == 1) {
      	        results[i] = results[i].concat(' (1 annotation)');
      	        cursor++;
      	      } else if (cursor < rows.length && rows[cursor].db_disease == diseaseID) {
      		      results[i] = results[i].concat(' (' + rows[cursor].quantity + ' annotations)');
      	        cursor++;
      	      } else {
      		      results[i] = results[i].concat(' (0 annotations)');
      	      }
            }
          }
          res.json({ matches: results });
        });
      } else {
        console.log('error02');
        res.json({ matches: [] });
      }
    });
  }
});

// HPO lookup
app.get('/solr/hpo/:query', function (req, res) {
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=' + req.params.query;
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var results = [];
      for (var i = 0; i < body.rows.length; i++) {
        if (req.params.vocabulary == 'hpo' && body.rows[0].term_category.indexOf('HP:0000118') == -1)
          continue;
        results.push(body.rows[i].name + ' <a class="goto-browser" title="Use phenotype browser"><i class="fa fa-info-circle" aria-hidden="true"></i></a>');
      }
      res.json({ matches: results });
    } else {
      console.log('error03');
    }
  });
});

// HPO definition lookup
app.post('/definition', function (req, res) {
  var phenotypeName = encodeURIComponent(req.body.phenotypeName);
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=' + phenotypeName;
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      res.json(body.rows[0]);
    } else {
      console.log('error04');
    }
  });
});

// HPO definitions lookup
app.post('/definitions', function (req, res) {
  var phenotypeNames = req.body.phenotypeNames;
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?q=HP&fq=id:(%22';
  for (var i = 0; i < phenotypeNames.length; i++) {
    if (i != 0)
      requestURL += '%22%20OR%20%22';
    requestURL += encodeURIComponent(phenotypeNames[i]);
  }
  requestURL += '%22)&vocabulary=hpo&rows=' + phenotypeNames.length;
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      res.json(body);
    } else {
      console.log('error05');
    }
  });
});

// Browse phenotype PART 1
app.post('/browse', function (req, res, next) {
  var requestURL;
  // Definition & more general phenotypes
  if (req.body.hpo) {
    var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=HP&fq=id:(%22' + req.body.hpo + '%22)';
  } else {
    var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=HP&fq=name:(%22' + req.body.name + '%22)';
  }
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      req.currentPhenotype = body.rows[0];
      next();
    } else {
      console.log('error06');
    }
  });
});

// Browse phenotype PART 2
app.post('/browse', function (req, res) {
  var hpo = req.currentPhenotype.id;
  // More specific phenotypes
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?q=HP&fq=is_a:(%22' + hpo + '%22)&vocabulary=hpo&rows=99';
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      specificPhenotypes = [];
      for (var i = 0; i < body.rows.length; i++) {
        specificPhenotypes.push({
          hpo: body.rows[i].id,
          name: body.rows[i].name
        });
      }
      generalPhenotypes = [];
      for (var i = 0; i < req.currentPhenotype.parents.length; i++) {
        if (req.currentPhenotype.id != "HP:0000118") {
          generalPhenotypes.push({
            hpo: req.currentPhenotype.parents[i].id,
            name: req.currentPhenotype.parents[i].name
          });
        }
      }
      res.json({
        hpo: req.currentPhenotype.id,
        name: req.currentPhenotype.name,
        definition: req.currentPhenotype.def,
        synonym: req.currentPhenotype.synonym,
        comment: req.currentPhenotype.comment,
        generalPhenotypes: generalPhenotypes,
        specificPhenotypes: specificPhenotypes
      });
    } else {
      console.log('error07');
    }
  });
});

// Reference lookup
app.get('/entrez/:query', function (req, res) {
  var requestURL = 'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=' + req.params.query + '&retmode=json&retmax=10';
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var pmids = body.esearchresult.idlist;
      if (pmids.length == 0)
        return res.json({ matches: [] });
      var requestURL = 'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=';
      for (var i = 0; i < pmids.length; i++) {
        requestURL += pmids[i] + '+';
      }
      requestURL += '&retmode=xml';
      request({url: requestURL}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          parseString(body, function (err, result) {
            if (err) throw err;
            var articles = [];
            for (var i = 0; i < result.PubmedArticleSet.PubmedArticle.length; i++) {
              articles.push(result.PubmedArticleSet.PubmedArticle[i].MedlineCitation[0].PMID[0]._ + ' ' + result.PubmedArticleSet.PubmedArticle[i].MedlineCitation[0].Article[0].ArticleTitle);
            }
            res.json({ matches: articles });
          });
        } else {
          console.log('error08');
        }
      });
    } else {
      console.log('error09');
    }
  });
});

// Reference metadata lookup
app.post('/efetch', function (req, res) {
  var pmid = req.body.pmid;
  var requestURL = 'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=' + pmid + '+&retmode=xml';
  request({url: requestURL}, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      parseString(body, function (err, result) {
        if (err) throw err;
        var response = {
          pmid: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].PMID[0]._,
          title: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].ArticleTitle,
          author: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].AuthorList[0].Author[0].LastName + ' ' + result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].AuthorList[0].Author[0].Initials,
          year: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].Journal[0].JournalIssue[0].PubDate[0].Year
        };
        res.json(response);
      });
    } else {
      console.log('error10');
    }
  });
});

// Routes requiring user to be logged in
app.post('/restricted/*', function (req, res, next) {
  if (req.body.link) {
    req.userID = -1;
    req.userLevel = -1;
    req.shareLink = connection.escape(req.body.link);
    next();
  } else if (!req.body.token) {
    return res.sendStatus(401);
  } else {
    var query = 'SELECT user_id FROM tokens WHERE token = ' + connection.escape(req.body.token);
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (rows.length > 0 && rows[0].user_id != '-1') {
        req.userID = rows[0].user_id;
        var query = 'SELECT level FROM users WHERE id = ' + req.userID;
        connection.query(query, function(err, rows) {
          if (err) throw err;
          req.userLevel = rows[0].level;
          next();
        });
      } else
        return res.sendStatus(401);
    });
  }
});

app.post('*/student/*', jsonParser, function (req, res, next) {
  if (req.userLevel !== 0)
    return res.sendStatus(403);
  next();
});

app.post('*/prof/*', jsonParser, function (req, res, next) {
  if (req.userLevel < 1)
    return res.sendStatus(403);
  next();
});

app.post('/forgot-password', function (req, res) {
  var email = connection.escape(req.body.email);
  if (!validator.validate(req.body.email))
    return res.sendStatus(403);
  var temporaryPassword = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (var i = 0; i < 10; i++)
    temporaryPassword += possible.charAt(Math.floor(Math.random() * possible.length));
  var resetKey = connection.escape(sha1(req.body.email + temporaryPassword));
  var query = 'UPDATE users SET reset_key = ' + resetKey + ', reset_times = reset_times + 1 WHERE email = ' + email;
  connection.query(query, function (err, result) {
    if (err) throw err;
    if (result.affectedRows > 0) {
      mailgun.messages().send({
        from: 'Phenotate <notifications@phenotate.org>',
        to: req.body.email,
        subject: 'Phenotate Password Reset',
        text: 'If you have requested to reset your Phenotate password, please use this single-use password to log in: ' + temporaryPassword + '\nIf not, you can invalidate the single-use password by logging in normally.'
      }, function (error, body) {
        if (error)
          console.log(error);
        if (body)
          console.log(body);
      });
    }
  });
  res.json({ success: true });
});

app.post('/signup', function (req, res, next) {
  var name = connection.escape(req.body.name);
  var email = connection.escape(req.body.email);
  var password = connection.escape(sha1(req.body.email + req.body.password));
  var inviteJoinCode = null;
  if (req.body.inviteJoinCode) {
    inviteJoinCode = req.body.inviteJoinCode;
  }
  var query0 = 'SELECT * FROM users WHERE email = ' + email + '; ';
  var query1 = 'SELECT * FROM `known_profs` WHERE email = ' + email + '; ';
  if (!validator.validate(req.body.email))
    return res.json({ loginValid: false, invalidInviteJoinCode: false });
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if (rows[0].length > 0) {
      // Email has already been taken
      return res.json({ loginValid: false, invalidInviteJoinCode: false });
    } else if (rows[1].length > 0) {
      // User is a known prof
      req.userLevel = 1;
      next();
    } else {
      req.userLevel = 0;
      if (inviteJoinCode) {
        // LOOK UP JOIN CODE
        var query = 'SELECT id, prof_id FROM classes WHERE join_code = ' + inviteJoinCode;
        connection.query(query, function(err, rows) {
          if (err) throw err;
          if (rows.length == 0 || rows[0].prof_id < 0) {
            // LOOK UP INVITE CODE
            query = 'SELECT * FROM invite_codes WHERE redeem_user_id IS NULL AND invite_code = ' + inviteJoinCode;
            connection.query(query, function(err, rows) {
              if (err) throw err;
              if (rows.length == 0) {
                return res.json({ loginValid: false, invalidInviteJoinCode: true });
              } else {
                req.userLevel = 1;
                next();
              }
            });
          } else {
            next();
          }
        });
      } else {
        next();
      }
    }
  });
});

app.post('/signup', function (req, res, next) {
  var name = connection.escape(req.body.name);
  var email = connection.escape(req.body.email);
  var password = connection.escape(sha1(req.body.email + req.body.password));
  request.post({
    url: 'http://community.phenotate.org/api/v1/users/',
    json: true,
    auth: {
      'bearer': tokenNodeBB
    },
    body: {
        username: req.body.email.replace('@', '-'),
        password: sha1(req.body.password),
        email: req.body.email,
        _uid: 1
    }
  }, function (error, response, body) {
    var communityUserID = -1;
    if (!error && response.statusCode == 200) {
	    communityUserID = body.payload.uid;
  	} else {
      console.log('error11');
    }
    if (req.userLevel > 0) {
      request.post({
        url: 'http://community.phenotate.org/api/v1/groups/profs/membership',
        json: true,
        auth: {
          'bearer': tokenNodeBB
        },
        body: {
          _uid: communityUserID
        }
      });
    }
    var query = 'INSERT INTO users (`full_name`, `email`, `password`, `level`, `community_user_id`) VALUES (' + name + ',' + email + ',' + password + ', ' + req.userLevel + ', ' + communityUserID + ')'
    connection.query(query, function(err, result) {
      var userID = result.insertId;
      // Sign up transaction (PhenoCash)
      query = 'INSERT INTO transactions (user_id, points, phenocash) VALUES (' + userID + ', ' + signupPoints + ', ' + signupPhenocash + ')';
      connection.query(query);
      // Join class if join code specified
      if (req.body.inviteJoinCode) {
        var inviteJoinCode = req.body.inviteJoinCode;
        query = 'SELECT id, prof_id FROM classes WHERE join_code = ' + inviteJoinCode;
        connection.query(query, function(err, rows) {
          if (err) throw err;
          if (rows.length == 0 || rows[0].prof_id < 0) {
            // TRY INVITE CODE
            query = 'UPDATE invite_codes SET redeem_user_id = ' + userID + ' WHERE redeem_user_id IS NULL AND invite_code = ' + inviteJoinCode;
            connection.query(query);
          } else {
            // JOIN CODE OK
            query = 'INSERT INTO students (`user_id`,`class_id`) VALUES (' + userID + ',' + rows[0].id + ')';
            connection.query(query);
            query = 'UPDATE classes SET deletable = 0 WHERE id = ' + rows[0].id;
            connection.query(query);
          }
          next();
        });
      } else {
        next();
      }
    });
  });
});

app.post(['/login', '/signup'], function (req, res) {
  var email = connection.escape(req.body.email);
  var password = connection.escape(sha1(req.body.email + req.body.password));
  var query0 = 'SELECT id, community_user_id FROM users WHERE email = ' + email + ' AND password = ' + password + ';';
  var query1 = 'SELECT id, community_user_id FROM users WHERE email = ' + email + ' AND reset_key = ' + password; // PASSWORD RESET KEY USED
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if (rows[0].length > 0 || rows[1].length > 0) {
      var resetKeyUsed = (rows[1].length > 0);
      var userID = (!resetKeyUsed) ? rows[0][0].id : rows[1][0].id;
      var communityUserID = (!resetKeyUsed) ? rows[0][0].community_user_id : rows[1][0].community_user_id;
      var query = 'SELECT FLOOR(100000000 + RAND() * 899999999) AS new_token FROM tokens WHERE "new_token" NOT IN (SELECT token FROM tokens) LIMIT 1';
      connection.query(query, function(err, rows) {
        if (err) throw err;
        var query = 'INSERT INTO tokens (`token`, `user_id`) VALUES (' + rows[0].new_token + ',' + userID + ')';
        connection.query(query);
        res.json({loginValid: true, token: rows[0].new_token, resetKeyUsed: resetKeyUsed, cookie: jwt.encode({
  	      "id": communityUserID,
  	      "username": req.body.email.replace('@', '-'),
  	      "email": req.body.email
        }, jwtSecret)});
      });
      if (resetKeyUsed) {
        query = "UPDATE users SET password = NULL WHERE id = " + userID;
        connection.query(query);
      }
      query = "UPDATE users SET reset_key = NULL WHERE id = " + userID;
      connection.query(query);
    } else {
      res.json({ loginValid: false });
      res.end();
    }
  });
});

app.post('/logout', function(req, res) {
  var query = 'DELETE FROM tokens WHERE token = ' + connection.escape(req.body.token);
  connection.query(query);
  res.json({ logout: true });
});

app.post('/restricted/user', function(req, res) {
  var query = 'SELECT full_name, level, email_follow, email_like, password FROM users WHERE id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    res.json({
      name: rows[0].full_name,
      level: rows[0].level,
      emailFollow: rows[0].email_follow,
      emailLike: rows[0].email_like,
      passwordReset: (rows[0].password) ? false : true
    });
  });
});

app.post('/restricted/change-password', function(req, res) {
  var query = 'SELECT email, community_user_id AS communityUserID FROM users WHERE id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    var communityUserID = rows[0].communityUserID;
    var password = connection.escape(sha1(rows[0].email + req.body.password));
    var newPassword = connection.escape(sha1(rows[0].email + req.body.newPassword));
    var query = 'SELECT email FROM users WHERE id = ' + req.userID + ' AND (password = ' + password + ' OR password IS NULL)';
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (rows.length > 0) {
        query = 'UPDATE users SET password = ' + newPassword + ' WHERE id = ' + req.userID + ' AND (password = ' + password + ' OR password IS NULL)';
        connection.query(query);
        request.put({
          url: 'http://community.phenotate.org/api/v1/users/' + communityUserID + '/password',
          json: true,
          auth: {
            'bearer': tokenNodeBB
          },
          body: {
              uid: communityUserID,
              'new': req.body.newPassword,
              _uid: 1
          }
        });
        res.json({passwordValid: true});
      } else {
        res.json({passwordValid: false});
      }
    });
  });
});

app.post('/restricted/email-prefs', function(req, res) {
  if (req.body.emailFollow === 0 || req.body.emailFollow === 1) {
    query = 'UPDATE users SET email_follow = ' + req.body.emailFollow + ' WHERE id = ' + req.userID;
    connection.query(query);
  } else if (req.body.emailLike === 0 || req.body.emailLike === 1) {
    query = 'UPDATE users SET email_like = ' + req.body.emailLike + ' WHERE id = ' + req.userID;
    connection.query(query);
  }
});

app.post('/restricted/student/upgrade-account', function(req, res) {
  var inviteCode = connection.escape(req.body.inviteCode);
  var query = 'UPDATE invite_codes SET redeem_user_id = ' + req.userID + ' WHERE redeem_user_id IS NULL AND invite_code = ' + inviteCode;
  connection.query(query, function(err, result) {
    if (err) throw err;
    if (result.changedRows > 0) {
      query = 'UPDATE users SET level = 1 WHERE id = ' + req.userID;
      connection.query(query);
      query = 'SELECT community_user_id AS communityUserID FROM users WHERE id = ' + req.userID;
      connection.query(query, function(err, rows) {
        request.post({
          url: 'http://community.phenotate.org/api/v1/groups/profs/membership',
          json: true,
          auth: {
            'bearer': tokenNodeBB
          },
          body: {
            _uid: rows[0].communityUserID
          }
        });
        res.json({ success: true });
      });
    } else {
      res.sendStatus(403);
    }
  });
});

app.post('/restricted/prof/invite-code/new', function(req, res) {
  var query = 'SELECT * FROM invite_codes WHERE user_id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length >= 10) {
      res.sendStatus(403);
    } else {
      query = 'INSERT INTO invite_codes (`invite_code`, `user_id`) SELECT FLOOR(100000000 + RAND() * 899999999) AS invite_code, ' + req.userID + ' FROM invite_codes WHERE "invite_code" NOT IN (SELECT join_code FROM classes) AND "invite_code" NOT IN (SELECT invite_code FROM invite_codes) LIMIT 1';
      connection.query(query, function(err, result) {
        if (err) throw err;
        query = 'SELECT invite_codes.id AS inviteCodeID, invite_code AS inviteCode, DATE_FORMAT(invite_codes.date_created, \'%Y-%m-%d\') AS dateCreated, full_name AS redeemedByName, email AS redeemedByEmail FROM invite_codes LEFT JOIN users ON invite_codes.redeem_user_id = users.id WHERE invite_codes.id = ' + result.insertId;
        connection.query(query, function(err, rows) {
          if (err) throw err;
          res.json(rows[0]);
        });
      });
    }
  });
});

app.post('/restricted/prof/invite-code/list', function(req, res) {
  var query = 'SELECT invite_codes.id AS inviteCodeID, invite_code AS inviteCode, DATE_FORMAT(invite_codes.date_created, \'%Y-%m-%d\') AS dateCreated, full_name AS redeemedByName, email AS redeemedByEmail FROM invite_codes LEFT JOIN users ON invite_codes.redeem_user_id = users.id WHERE user_id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    res.json({ inviteCodes: rows });
  });
});

app.post('/restricted/prof/invite-code/remove', function(req, res) {
  var inviteCodeID = connection.escape(req.body.inviteCodeID);
  var query = 'DELETE FROM invite_codes WHERE user_id = ' + req.userID + ' AND id = ' + inviteCodeID + ' AND redeem_user_id IS NULL';
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/prof/new-class', function(req, res) {
  var name = connection.escape(req.body.name);
  var query = 'SELECT FLOOR(100000000 + RAND() * 899999999) AS join_code FROM classes WHERE "join_code" NOT IN (SELECT join_code FROM classes) AND "join_code" NOT IN (SELECT invite_code FROM invite_codes) LIMIT 1';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    query = 'INSERT INTO classes (`name`,`prof_id`,`join_code`) VALUES (' + name + ',' + req.userID + ',' + rows[0].join_code + ')';
    connection.query(query);
    res.json({ success: true });
  });
});

// Get all the classes associated with user
app.post('/restricted/classes/*', function(req, res, next) {
  var classes = [];
  if (req.userLevel < 1) {
    // Student
    var query = 'SELECT class_id, name FROM students INNER JOIN classes ON students.class_id = classes.id WHERE user_id = ' + req.userID + ' ORDER BY students.date_created DESC';
    connection.query(query, function(err, rows) {
      if (err) throw err;
      for (var i = 0; i < rows.length; i++) {
        classes.push({id: rows[i].class_id, name: rows[i].name});
      }
      req.userClasses = classes;
      next();
    });
  } else {
    // Prof
    var query = 'SELECT id, name, join_code FROM classes WHERE prof_id = ' + req.userID + ' ORDER BY date_created DESC';
    connection.query(query, function(err, rows) {
      if (err) throw err;
      for (var i = 0; i < rows.length; i++) {
        classes.push({id: rows[i].id, name: rows[i].name, joinCode: rows[i].join_code});
      }
      req.userClasses = classes;
      next();
    });
  }
});

app.post('/restricted/classes/list', function(req, res) {
  res.json({ classes: req.userClasses });
});

app.post('/restricted/classes/student/join-class', function(req, res) {
  var joinCode = connection.escape(req.body.joinCode);
  var query = 'SELECT id, prof_id FROM classes WHERE join_code = ' + joinCode;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0 || rows[0].prof_id < 0)
      return res.json({ notFound: true });
    // Check if already joined
    for (var i = 0; i < req.userClasses.length; i++) {
      if (req.userClasses[i].id == rows[0].id)
        return res.json({ notFound: false, alreadyJoined: true });
    }
    query = 'INSERT INTO students (`user_id`,`class_id`) VALUES (' + req.userID + ',' + rows[0].id + ')';
    connection.query(query);
    query = 'UPDATE classes SET deletable = 0 WHERE id = ' + rows[0].id;
    connection.query(query);
    return res.json({ notFound: false, alreadyJoined: false });
  });
});

app.post('/restricted/annotations/new-annotation-precheck', function(req, res) {
  var diseaseName = req.body.diseaseName.replace(/[^a-zA-Z0-9 ]/g, '');
  var vocabulary = req.body.vocabulary.replace(/[^a-zA-Z ]/g, '');
  // Look up disease name on Solr
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + vocabulary + '&q=' + vocabulary.toUpperCase() + '&fq=id:(%22' + vocabulary.toUpperCase() + ':' + diseaseName + '%22)';
  if (vocabulary == "omim")
    requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + vocabulary + '&q=' + diseaseName;
  request({
    url: requestURL,
    json: true
  }, function (error, response, body) {
    var actualSymptoms = body.rows[0].actual_symptom;
    var actualNotSymptoms = body.rows[0].actual_not_symptom;
    var prefillAvailable = ((actualSymptoms && actualSymptoms.length > 0) || (actualNotSymptoms && actualNotSymptoms.length > 0));
    // Is there an ongoing exercise with this disease?
    var query = 'SELECT COUNT(problems.id) AS total FROM problems LEFT JOIN exercises ON problems.exercise_id = exercises.id LEFT JOIN diseases ON problems.disease_id = diseases.id WHERE db = ' + connection.escape(vocabulary) + ' AND db_disease = ' + body.rows[0].id.match(/\d+/)[0] + ' AND date_start IS NOT NULL AND date_start <= NOW() AND (date_end IS NULL OR date_end > NOW())';
    connection.query(query, function(err, rows) {
      if (err) throw err;
      return res.json({
        prefillAvailable: prefillAvailable,
        ongoingExercise: (rows[0].total > 0),
        costInPhenocashToPrefillAnnotation: costInPhenocashToPrefillAnnotation
      });
    });
  });
});

app.post('/restricted/annotations/student/new-annotation', function(req, res, next) {
  var classID = req.body.classID;
  var diseaseNameWords = req.body.diseaseName.replace(/[^a-zA-Z0-9 ]/g, '').split(' ');
  var diseaseID = diseaseNameWords[0];
  var vocabulary = req.body.vocabulary.replace(/[^a-zA-Z ]/g, '');
  // Is there an ongoing exercise with this disease?
  var query0 = 'SELECT COUNT(problems.id) AS total FROM problems LEFT JOIN exercises ON problems.exercise_id = exercises.id LEFT JOIN diseases ON problems.disease_id = diseases.id WHERE db = ' + connection.escape(vocabulary) + ' AND db_disease = ' + connection.escape(diseaseID) + ' AND date_start IS NOT NULL AND date_start <= NOW() AND (date_end IS NULL OR date_end > NOW());';
  // Enough PhenoCash to spend on prefill?
  var query1 = 'SELECT SUM(phenocash) AS total FROM transactions WHERE user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
  // At least one empty annotation slot?
  var query2 = 'SELECT COUNT(annotations.id) AS total FROM annotations LEFT JOIN transactions ON annotations.id = transactions.annotation_id WHERE annotations.user_id = ' + req.userID + ' AND status = 1 AND reward = 1 AND class_id = ' + classID + ';';
  var query3 = 'SELECT COUNT(id) AS total FROM transactions WHERE add_annotation_slot = 1 AND user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
  // Check if being annotated by user in this class (for grab bag)
  var query4 = 'SELECT COUNT(annotations.id) AS total FROM annotations LEFT JOIN transactions ON annotations.id = transactions.annotation_id LEFT JOIN diseases ON annotations.disease_id = diseases.id WHERE status = 1 AND class_id = ' + classID + ' AND annotations.user_id = ' + req.userID + ' AND db = ' + connection.escape(vocabulary) + ' AND db_disease = ' + connection.escape(diseaseID) + ';';
  // Check if the student has already reached the annotation limit for this disease
  var query5 = 'SELECT COUNT(annotations.id) AS total FROM annotations LEFT JOIN diseases ON annotations.disease_id = diseases.id WHERE (status = 1 OR status = 2) AND user_id = ' + req.userID + ' AND db = ' + connection.escape(vocabulary) + ' AND db_disease = ' + connection.escape(diseaseID);
  connection.query(query0 + query1 + query2 + query3 + query4 + query5, function(err, rows) {
    if (err) throw err;
    if ((rows[0][0].total > 0 || rows[1][0].total < costInPhenocashToPrefillAnnotation) && !req.body.startFromScratch)
      return res.sendStatus(403);
    if (rows[2][0].total >= rows[3][0].total + minNumAnnotationSlots || rows[4][0].total > 0 || rows[5][0].total > maxNumAnnotationsPerDiseasePerStudent)
      return res.sendStatus(403);
    next();
  });
});

app.post(['/restricted/annotations/prof/new-annotation', '/restricted/annotations/student/new-annotation'], function(req, res, next) {
  var diseaseNameWords = req.body.diseaseName.replace(/[^a-zA-Z0-9 ]/g, '').split(' ');
  var diseaseID = diseaseNameWords[0];
  var vocabulary = req.body.vocabulary.replace(/[^a-zA-Z ]/g, '');
  var status = 1;
  var nOfOne = 0;
  if (req.body.nOfOne)
    nOfOne = 1;
  if (req.body.publishTemporarily)
    status = 3;
  // Look up disease name on Solr
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + vocabulary + '&q=' + vocabulary.toUpperCase() + '&fq=id:(%22' + vocabulary.toUpperCase() + ':' + diseaseID + '%22)';
  if (vocabulary == "omim")
    requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + vocabulary + '&q=' + diseaseID;
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200 && body.rows.length > 0) {
      var query = 'SELECT id FROM diseases WHERE db = ' + connection.escape(vocabulary) + ' AND db_disease = ' + body.rows[0].id.match(/\d+/)[0];
      req.diseaseDB = vocabulary;
      req.dbDisease = body.rows[0].id.match(/\d+/)[0];
      connection.query(query, function(err, rows) {
        if (err) throw err;
        if (rows.length == 0) {
          var diseaseName;
          if (vocabulary == 'ordo') {
            diseaseName = '@' + body.rows[0].id.replace(/[^0-9]/g, '') + ' ' + body.rows[0].name;
          } else if (vocabulary == 'omim') {
            diseaseName = (body.rows[0].symbol ? body.rows[0].symbol : '') + body.rows[0].id + ' ' + body.rows[0].name;
          }
          query = 'INSERT INTO diseases (`db`,`db_disease`,`name`) VALUES (' + connection.escape(vocabulary) + ',' + body.rows[0].id.match(/\d+/)[0] + ',"' + diseaseName + '")';
          connection.query(query, function(err, result) {
            if (err) throw err;
            query = 'INSERT INTO annotations (`disease_id`,`user_id`,`status`,`n_of_one`) VALUES (' + result.insertId + ',' + req.userID + ',' + status + ',' + nOfOne + ')';
            connection.query(query, function(err, result) {
              if (err) throw err;
              req.startFromScratch = req.body.startFromScratch;
              req.annotationID = result.insertId;
              req.solrBody = body;
              next();
            });
          });
        } else {
          query = 'INSERT INTO annotations (`disease_id`,`user_id`,`status`,`n_of_one`) VALUES (' + rows[0].id + ',' + req.userID + ',' + status + ',' + nOfOne + ')';
          connection.query(query, function(err, result) {
            if (err) throw err;
            req.startFromScratch = req.body.startFromScratch;
            req.annotationID = result.insertId;
            req.solrBody = body;
            next(); // Continued ~1000 lines later
          });
        }
      });
    }
  });
});

app.post('/restricted/annotations/student/new-annotation', function(req, res, next) {
  var classID = req.body.classID;
  var diseaseNameWords = req.body.diseaseName.replace(/[^a-zA-Z0-9 ]/g, '').split(' ');
  var diseaseID = diseaseNameWords[0];
  var vocabulary = req.body.vocabulary.replace(/[^a-zA-Z ]/g, '');
  // Check if previously annotated by user (across all classes), then assign reward
  var query = 'SELECT COUNT(annotations.id) AS total FROM annotations LEFT JOIN transactions ON annotations.id = transactions.annotation_id LEFT JOIN diseases ON annotations.disease_id = diseases.id WHERE status = 2 AND annotations.user_id = ' + req.userID + ' AND db = ' + connection.escape(vocabulary) + ' AND db_disease = ' + connection.escape(diseaseID) + ' AND annotations.id != ' + req.annotationID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows[0].total > 0) {
      query = 'INSERT INTO transactions (points, phenocash, user_id, class_id, annotation_id, reward, pending) VALUES (' + rewardInPointsForCustomAnnotationResubmission + ',' + rewardInPhenocashForCustomAnnotationResubmission + ',' + req.userID + ',' + classID + ',' + req.annotationID + ',1,1)';
    } else {
      var rewardInPoints = rewardInPointsForCustomAnnotation;
      var rewardInPhenocash = rewardInPhenocashForCustomAnnotation;
      // Is it a featured disease?
      for (var i = 0; i < featuredDiseases.length; i++) {
        var featuredDiseaseNameWords = featuredDiseases[i].diseaseName.replace(/[^a-zA-Z0-9 ]/g, '').split(' ');
        var featuredDiseaseID = featuredDiseaseNameWords[0];
        var featuredVocabulary = featuredDiseases[i].vocabulary.replace(/[^a-zA-Z ]/g, '');
        if (vocabulary == featuredVocabulary && diseaseID == featuredDiseaseID) {
          rewardInPoints = featuredDiseases[i].rewardInPoints;
          rewardInPhenocash = featuredDiseases[i].rewardInPhenocash;
        }
      }
      query = 'INSERT INTO transactions (points, phenocash, user_id, class_id, annotation_id, reward, pending) VALUES (' + rewardInPoints + ',' + rewardInPhenocash + ',' + req.userID + ',' + classID + ',' + req.annotationID + ',1,1)';
    }
    connection.query(query);
    // Spend PhenoCash on prefill
    if (!req.body.startFromScratch) {
      query = 'INSERT INTO transactions (phenocash, user_id, annotation_id, class_id) VALUES (' + (-1 * costInPhenocashToPrefillAnnotation) + ',' + req.userID + ',' + req.annotationID + ',' + classID + ')';
      connection.query(query);
    }
    next();
  });
});

app.post('/restricted/annotations/prof/list', function(req, res) {
  var myAnnotations = [];
  var query = 'SELECT annotations.id, db, db_disease, name, status, DATE_FORMAT(date_created, \'%Y-%m-%d\') AS date_created FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE user_id = ' + req.userID + ' AND status != 3';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    for (var i = 0; i < rows.length; i++) {
      myAnnotations.push({
        id: rows[i].id,
        db: rows[i].db,
        db_disease: rows[i].db_disease,
        diseaseName: rows[i].name,
        status: rows[i].status,
        date: rows[i].date_created
      });
    }
    return res.json({ annotations: myAnnotations });
  });
});

app.post('/restricted/annotations/student/list', function(req, res) {
  var classID = req.body.classID;
  var myAnnotations = [];
  var query0 = 'SELECT annotations.id, db, db_disease, name, status, points, phenocash, DATE_FORMAT(annotations.date_created, \'%Y-%m-%d\') AS date_created FROM annotations LEFT JOIN diseases ON annotations.disease_id = diseases.id LEFT JOIN transactions ON annotations.id = transactions.annotation_id WHERE annotations.user_id = ' + req.userID + ' AND (status = 1 OR status = 2) AND reward = 1 AND class_id = ' + classID + ';';
  var query1 = 'SELECT COUNT(id) AS total FROM transactions WHERE add_annotation_slot = 1 AND user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
  var query2 = 'SELECT SUM(phenocash) AS total FROM transactions WHERE user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    var numInProgressAnnotations = 0;
    for (var i = 0; i < rows[0].length; i++) {
      myAnnotations.push({
        id: rows[0][i].id,
        db: rows[0][i].db,
        db_disease: rows[0][i].db_disease,
        diseaseName: rows[0][i].name,
        rewardInPoints: rows[0][i].points,
        rewardInPhenocash: rows[0][i].phenocash,
        status: rows[0][i].status,
        date: rows[0][i].date_created
      });
      if (rows[0][i].status == 1)
        numInProgressAnnotations++;
    }
    return res.json({
      annotations: myAnnotations,
      numInProgressAnnotations: numInProgressAnnotations,
      numAnnotationSlots: minNumAnnotationSlots + rows[1][0].total,
      costInPhenocashToAddAnnotationSlot: costInPhenocashToAddAnnotationSlotBase + costInPhenocashToAddAnnotationSlotAdditional * rows[1][0].total,
      phenocashBalance: (rows[2][0].total) ? rows[2][0].total : 0
    });
  });
});

app.post('/restricted/annotations/student/add-annotation-slot', function(req, res) {
  var classID = req.body.classID;
  var query0 = 'SELECT SUM(phenocash) AS total FROM transactions WHERE user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
  var query1 = 'SELECT COUNT(id) AS total FROM transactions WHERE add_annotation_slot = 1 AND user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if (rows[0][0].total && rows[0][0].total >= costInPhenocashToAddAnnotationSlotBase + costInPhenocashToAddAnnotationSlotAdditional * rows[1][0].total) {
      var query = 'INSERT INTO transactions (phenocash, user_id, class_id, add_annotation_slot) VALUES (' + (-1 * (costInPhenocashToAddAnnotationSlotBase + costInPhenocashToAddAnnotationSlotAdditional * rows[1][0].total)) + ',' + req.userID + ',' + classID + ',1)';
      connection.query(query, function(err, result) {
        return res.json({ success: true });
      });
    } else {
      return res.sendStatus(403);
    }
  });
});

app.post('/restricted/phenository/prof/following', function(req, res) {
  var dbDisease = connection.escape(req.body.dbDisease);
  var vocabulary =  connection.escape(req.body.vocabulary);
  var query = 'SELECT follows.id FROM follows WHERE user_id = ' + req.userID + ' AND db = ' + vocabulary + ' AND db_disease = ' + dbDisease;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length > 0) {
      return res.json({ following: true });
    } else {
      return res.json({ following: false });
    }
  });
});

app.post('/restricted/phenository/prof/follow', function(req, res) {
  var dbDisease = connection.escape(req.body.dbDisease);
  var vocabulary =  connection.escape(req.body.vocabulary);
  if (req.body.follow) {
    var query = 'SELECT id FROM follows WHERE user_id = ' + req.userID + ' AND db = ' + vocabulary + ' AND db_disease = ' + dbDisease;
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (rows.length == 0) {
        query = 'INSERT INTO follows (`user_id`,`db`,`db_disease`) VALUES (' + req.userID + ',' + vocabulary + ',' + dbDisease + ')';
        connection.query(query);
      }
      return res.json({ following: true });
    });
  } else {
    query = 'DELETE FROM follows WHERE user_id = ' + req.userID + ' AND db = ' + vocabulary + ' AND db_disease = ' + dbDisease;
    connection.query(query);
    return res.json({ following: false });
  }
});

app.post('/restricted/phenository/prof/diseases', function(req, res) {
  var offset = parseInt(req.body.offset);
  var limit = parseInt(req.body.limit);
  var diseasesList = [];
  var query0 = 'SELECT COUNT(DISTINCT disease_id) AS total FROM annotations WHERE status = 2 AND n_of_one = 0;';
  var query1 = 'SELECT annotations.disease_id AS diseaseID, diseases.db AS diseaseDB, diseases.db_disease AS dbDisease, name, (SELECT COUNT(*) FROM annotations WHERE annotations.disease_id = diseaseID AND status = 2 AND n_of_one = 0) AS quantity, (SELECT COUNT(*) FROM follows WHERE db = diseaseDB AND db_disease = dbDisease AND user_id = ' + req.userID + ') AS following FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE status = 2 AND n_of_one = 0 GROUP BY disease_id ORDER BY date_published DESC LIMIT ' + limit + ' OFFSET ' + offset;
  if (req.body.following) {
    query0 = 'SELECT COUNT(DISTINCT db, db_disease) AS total FROM follows WHERE user_id = ' + req.userID + ';';
    query1 = 'SELECT diseases.id AS diseaseID, follows.db AS diseaseDB, follows.db_disease AS dbDisease, diseases.name AS name, (SELECT COUNT(*) FROM annotations WHERE annotations.disease_id = diseaseID AND status = 2) AS quantity, CONCAT(1) AS following FROM follows LEFT JOIN diseases ON diseases.db = follows.db AND diseases.db_disease = follows.db_disease WHERE user_id = ' + req.userID + ' GROUP BY diseaseDB, dbDisease ORDER BY date_created DESC LIMIT ' + limit + ' OFFSET ' + offset;
  }
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    for (var i = 0; i < rows[1].length; i++) {
      var follow = false;
      if (rows[1][i].following > 0)
        follow = true;
      var diseaseName = rows[1][i].dbDisease + ' (' + rows[1][i].diseaseDB.toUpperCase() + ')';
      if (rows[1][i].name !== null)
        diseaseName = rows[1][i].name;
      diseasesList.push({ id: rows[1][i].diseaseID , name: diseaseName, quantity: rows[1][i].quantity, following: follow, db: rows[1][i].diseaseDB });
    }
    return res.json({ totalDiseases: rows[0][0].total, diseases: diseasesList });
  });
});

app.post('/restricted/phenository/prof/annotations', function(req, res) {
  var dbDisease = connection.escape(req.body.dbDisease);
  var vocabulary =  connection.escape(req.body.vocabulary);
  var query = 'SELECT annotations.id AS annotationID, clone_of AS cloneOf, users.id AS authorID, full_name AS author, (SELECT COUNT(*) FROM annotations WHERE clone_of = annotationID AND status = 2) AS numClones, (SELECT COUNT(*) FROM likes WHERE annotation_id = annotationID) AS numLikes, DATE_FORMAT(date_published, \'%Y-%m-%d\') AS date, level FROM annotations INNER JOIN users ON annotations.user_id = users.id INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE status = 2 AND n_of_one = 0 AND db = ' + vocabulary + ' AND db_disease = ' + dbDisease;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    for (var i = 0; i < rows.length; i++) {
      rows[i].authorAdmin = (rows[i].authorID <= maxAdminID);
      rows[i].authorProf = (rows[i].level > 0);
    }
    return res.json({ annotations: rows });
  });
});

app.post('/restricted/annotation/*', function(req, res, next) {
  var annotationID = null;
  if (req.body.annotationID) {
    annotationID = connection.escape(req.body.annotationID);
  }
  var query = 'SELECT id AS annotationID, status, disease_id AS diseaseID FROM annotations WHERE id';
  if (req.userLevel > 0) {
    query += ' = ' + annotationID + ' AND (user_id = ' + req.userID + ' OR status = 2 OR status = -2)'; // Profs can view students' annotations
  } else if (req.shareLink) {
    query += ' IN (SELECT annotation_id AS annotationID FROM shares WHERE link = ' + req.shareLink + ')';
  } else {
    query += ' = ' + annotationID + ' AND (user_id = ' + req.userID + ' OR id IN (SELECT compare_to_annotation_id FROM annotations WHERE user_id = ' + req.userID + ' AND released = 1) OR id IN (SELECT id FROM annotations WHERE disease_id IN (SELECT disease_id FROM annotations WHERE user_id = ' + req.userID + ' AND status = 2)))';
  }
  connection.query(query, function(err, rows) {
    if (err) throw err;
    // Check if an annotation exists and can be accessed
    if (rows.length == 0)
      return res.sendStatus(403);
    req.annotationID = rows[0].annotationID;
    req.annotationStatus = rows[0].status;
    req.diseaseID = rows[0].diseaseID;
    next();
  });
});

app.post('/restricted/annotation/edit/*', function(req, res, next) {
  if (req.annotationStatus == 3 || req.annotationStatus == 2 || req.annotationStatus == -2)
    return res.sendStatus(403);
  var query = 'SELECT status FROM annotations WHERE id = ' + req.annotationID + ' AND user_id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    // Check if the annotation belongs to the user
    if (rows.length == 0)
      return res.sendStatus(403);
    next();
  });
});

app.post('/restricted/annotation/view/full', function(req, res) {
  var annotationID = req.annotationID;
  var query0 = 'SELECT annotations.id AS annotationID, status, clone_of AS cloneOf, user_id AS userID, full_name AS author, email, DATE_FORMAT(annotations.date_created, \'%Y-%m-%d\') AS dateCreated, DATE_FORMAT(date_published, \'%Y-%m-%d\') AS datePublished, disease_id AS diseaseID, diseases.db AS diseaseDB, diseases.db_disease AS dbDisease, diseases.name AS diseaseName, exercises.id AS exerciseID, exercises.name AS exerciseName, class_id AS classID, score, released, memo, compare_to_annotation_id AS compareToAnnotationID, community_topic_id AS communityTopicID, level, n_of_one AS nOfOne FROM annotations LEFT JOIN exercises ON annotations.exercise_id = exercises.id INNER JOIN diseases ON annotations.disease_id = diseases.id INNER JOIN users ON annotations.user_id = users.id WHERE annotations.id = ' + annotationID + ';';
  var query1 = 'SELECT likes.user_id as userID FROM likes INNER JOIN users ON likes.user_id = users.id WHERE annotation_id = ' + annotationID + ';';
  var query2 = 'SELECT annotations.id AS annotationID, user_id AS userID, full_name AS author, email, DATE_FORMAT(date_published, \'%Y-%m-%d\') AS datePublished FROM annotations INNER JOIN users ON annotations.user_id = users.id WHERE clone_of = ' + annotationID + ' AND status = 2;';
  var query3 = 'SELECT phenotypes.id AS phenotypeID, hpo, observed, frequency, frequency_to, onset, onset_to, not_ok, system AS systemHPO, specific_onset AS specificOnset, progression, severity, temporal_pattern AS temporalPattern, spatial_pattern AS spatialPattern, laterality FROM phenotypes WHERE annotation_id = ' + annotationID + ' ORDER BY phenotypeID ASC;';
  var query4 = 'SELECT refs.id AS refID, pmid FROM refs WHERE annotation_id = ' + annotationID + ' ORDER BY refs.id ASC;';
  var query5 = 'SELECT annotations.id AS annotationID, name AS diseaseName FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE exercise_id IN (SELECT exercise_id FROM annotations WHERE annotations.id = ' + annotationID + ') AND user_id = ' + req.userID + ';';
  var query6 = 'SELECT points, phenocash FROM transactions WHERE reward = 1 AND annotation_id = ' + annotationID;
  connection.query(query0 + query1 + query2 + query3 + query4 + query5 + query6, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0) {
      return res.sendStatus(403);
    }
    // Process likes
    var likes = 0;
    var liked = false;
    for (var i = 0; i < rows[1].length; i++) {
      likes++;
      if (rows[1][i].userID == req.userID)
        liked = true;
    }
    // Process clones
    var clones = [];
    for (var i = 0; i < rows[2].length; i++) {
      clones.push({
        annotationID: rows[2][i].annotationID,
        author: {
          userID: rows[2][i].userID,
          userName: rows[2][i].author,
          userEmail: rows[2][i].email
        },
        datePublished: rows[2][i].datePublished
      });
    }
    // Process phenotypes
    var phenotypes = [];
    for (var i = 0; i < rows[3].length; i++) {
      phenotypes.push({
        phenotypeID: rows[3][i].phenotypeID,
        hpo: rows[3][i].hpo,
        observed: rows[3][i].observed,
        frequency: rows[3][i].frequency,
        frequencyTo: rows[3][i].frequency_to,
        onset: rows[3][i].onset,
        onsetTo: rows[3][i].onset_to,
        phenotypeName: 'Loading…',
        phenotypeDefinition: null,
        display: true,
        systemHPO: rows[3][i].systemHPO,
        systemName: null,
        citations: [],
        notOK: rows[3][i].not_ok,
        specificOnset: rows[3][i].specificOnset,
        progression: rows[3][i].progression,
        severity: rows[3][i].severity,
        temporalPattern: rows[3][i].temporalPattern,
        spatialPattern: rows[3][i].spatialPattern,
        laterality: rows[3][i].laterality
      });
    }
    // Process refs
    var refs = [];
    for (var i = 0; i < rows[4].length; i++) {
      refs.push({
        refID: rows[4][i].refID,
        pmid: rows[4][i].pmid,
        title: null,
        author: 'Loading…',
        year: null
      });
    }
    // Process exercise annotations
    var exerciseAnnotations = [];
    for (var i = 0; i < rows[5].length; i++) {
      exerciseAnnotations.push({
        annotationID: rows[5][i].annotationID,
        diseaseName: rows[5][i].diseaseName
      });
    }
    // Finish up
    var annotation = {
      annotationID: rows[0][0].annotationID,
      status: rows[0][0].status,
      cloneOf: rows[0][0].cloneOf,
      author: {
        userID: rows[0][0].userID,
        userName: rows[0][0].author,
        userEmail: rows[0][0].email,
        userAdmin: (rows[0][0].userID <= maxAdminID),
        userProf: (rows[0][0].level > 0),
        userHPO: (hpoUserIDs.indexOf(rows[0][0].userID) >= 0)
      },
      dateCreated: rows[0][0].dateCreated,
      datePublished: rows[0][0].datePublished,
      disease: {
        diseaseID: rows[0][0].diseaseID,
        diseaseDB: rows[0][0].diseaseDB,
        dbDisease: rows[0][0].dbDisease,
        diseaseName: rows[0][0].diseaseName
      },
      exerciseID: rows[0][0].exerciseID,
      exerciseName: rows[0][0].exerciseName,
      classID: rows[0][0].classID,
      likes: likes,
      liked: liked,
      clones: clones,
      phenotypes: phenotypes,
      refs: refs,
      exerciseAnnotations: exerciseAnnotations,
      score: (rows[0][0].released == 1) ? rows[0][0].score : null,
      released: (rows[0][0].released == 1) ? true : false,
      memo: (rows[0][0].released == 1) ? rows[0][0].memo : null,
      compareToAnnotationID: rows[0][0].compareToAnnotationID,
      communityTopicID: rows[0][0].communityTopicID,
      rewardInPoints: (rows[6][0]) ? rows[6][0].points : null,
      rewardInPhenocash: (rows[6][0]) ? rows[6][0].phenocash : null,
      nOfOne: (rows[0][0].nOfOne == 1)
    };
    return res.json(annotation);
  });
});

app.post('/restricted/annotation/edit/phenotype/add', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeName = encodeURIComponent(req.body.phenotypeName);
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=hpo&q=' + phenotypeName;
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var hpoID = connection.escape(body.rows[0].id);
      var query = 'SELECT id FROM phenotypes WHERE annotation_id = ' + annotationID + ' AND hpo = ' + hpoID;
      connection.query(query, function(err, rows) {
        if (err) throw err;
        // Avoid duplicate
        if (rows.length > 0)
          return res.sendStatus(403);
        // Phenotypic abnormalities only
        if (body.rows[0].term_category.indexOf('HP:0000118') == -1)
          return res.sendStatus(403);
        if (!req.body.phenotypeID) {
          //Add phenotype from scratch
          query = 'INSERT INTO phenotypes (annotation_id, hpo) VALUES (' + annotationID + ',' + hpoID + ')';
          connection.query(query);
          res.json({ success: true });
        } else {
          // If req.phenotypeID is set, we are changing phenotypes.
          query = 'INSERT INTO phenotypes (annotation_id, hpo, observed, frequency, frequency_to, onset, onset_to, specific_onset, progression, severity, temporal_pattern, spatial_pattern, laterality) SELECT ' + annotationID + ', ' + hpoID + ', observed, frequency, frequency_to, onset, onset_to, specific_onset, progression, severity, temporal_pattern, spatial_pattern, laterality FROM phenotypes WHERE id = ' + req.body.phenotypeID;
          connection.query(query, function(err, result) {
            // Update citations
            query = 'UPDATE citations SET phenotype_id = ' + result.insertId + ' WHERE phenotype_id = ' + req.body.phenotypeID;
            connection.query(query);
            res.json({ success: true });
          });
        }
      });
    } else {
      console.log('error12');
    }
  });
});

app.post('/restricted/annotation/edit/phenotype/observed', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var observed = (req.body.observed) ? '1' : '0';
  var query = 'UPDATE phenotypes SET observed = ' + observed + ', not_ok = 0 WHERE annotation_id = ' + annotationID + ' AND id = ' + phenotypeID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    res.json({ phenotypeID: req.body.phenotypeID, observed: observed });
  });
});

app.post('/restricted/annotation/edit/phenotype/frequency', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var frequency = connection.escape(req.body.frequency);
  var frequencyTo = connection.escape(req.body.frequencyTo);
  if ((frequencyTo != -1 && frequencyTo <= frequency) || !(frequency == -1 || (frequency > 0 && frequency <= 1)) || !(frequencyTo == -1 || (frequencyTo > 0 && frequencyTo <= 1))) {
    return res.sendStatus(403);
  }
  var query = 'UPDATE phenotypes SET frequency = ' + frequency + ', frequency_to = ' + frequencyTo + ', not_ok = 0 WHERE annotation_id = ' + annotationID + ' AND id = ' + phenotypeID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    res.json({ phenotypeID: req.body.phenotypeID, frequency: req.body.frequency, frequencyTo: req.body.frequencyTo });
  });
});

app.post('/restricted/annotation/edit/phenotype/onset', function(req, res) {
  var onsets = ['HP:0030674', 'HP:0003577', 'HP:0003623', 'HP:0003593', 'HP:0011463', 'HP:0003621', 'HP:0003581'];
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var onset = connection.escape(req.body.onset);
  var onsetTo = connection.escape(req.body.onsetTo);
  if ((req.body.onsetTo != '-1' && onsets.indexOf(req.body.onset) >= onsets.indexOf(req.body.onsetTo)) || (req.body.onset == '-1' && req.body.onsetTo != '-1')) {
    return res.sendStatus(403);
  }
  if (req.body.setOK)
  	var query = 'UPDATE phenotypes SET onset = ' + onset + ', onset_to = ' + onsetTo + ', not_ok = 0 WHERE annotation_id = ' + annotationID + ' AND id = ' + phenotypeID;
  else
  	var query = 'UPDATE phenotypes SET onset = ' + onset + ', onset_to = ' + onsetTo + ' WHERE annotation_id = ' + annotationID + ' AND id = ' + phenotypeID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    res.json({ phenotypeID: req.body.phenotypeID, onset: req.body.onset, onsetTo: req.body.onsetTo });
  });
});

app.post('/restricted/annotation/edit/phenotype/detail', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var detail = req.body.detail;
  var value = connection.escape(req.body.value);
  var possibleDetails = [
    'specific_onset',
    'progression',
    'severity',
    'temporal_pattern',
    'spatial_pattern',
    'laterality'
  ];
  if (possibleDetails.indexOf(detail) == -1)
    return res.sendStatus(403);
  var query = 'UPDATE phenotypes SET ' + detail + ' = ' + value + ', not_ok = 0 WHERE annotation_id = ' + annotationID + ' AND id = ' + phenotypeID;
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/annotation/edit/phenotype/remove', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var query = 'DELETE citations FROM citations INNER JOIN phenotypes ON citations.phenotype_id = phenotypes.id WHERE annotation_id = ' + annotationID + ' AND phenotype_id = ' + phenotypeID;
  connection.query(query);
  query = 'DELETE FROM phenotypes WHERE annotation_id = ' + annotationID + ' AND id = ' + phenotypeID;
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/annotation/edit/ref/add', function(req, res) {
  var annotationID = req.annotationID;
  var pmid = req.body.pmid;
  var requestURL = 'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=' + pmid + '+&retmode=xml';
  request({url: requestURL}, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      parseString(body, function (err, result) {
        if (err) throw err;
        pmid = connection.escape(result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].PMID[0]._);
        var query = 'SELECT id FROM refs WHERE annotation_id = ' + annotationID + ' AND pmid = ' + pmid;
        connection.query(query, function(err, rows) {
          if (err) throw err;
          // Avoid duplicate
          if (rows.length > 0)
            return res.sendStatus(403);
          query = 'INSERT INTO refs (annotation_id, pmid) VALUES (' + annotationID + ',' + pmid + ')';
          connection.query(query, function(err, resultat) {
            if (err) throw err;
            var response = {
              refID: resultat.insertId,
              pmid: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].PMID[0]._,
              title: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].ArticleTitle,
              author: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].AuthorList[0].Author[0].LastName + ' ' + result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].AuthorList[0].Author[0].Initials,
              year: result.PubmedArticleSet.PubmedArticle[0].MedlineCitation[0].Article[0].Journal[0].JournalIssue[0].PubDate[0].Year
            };
            res.json(response);
          });
        });
      });
    } else {
      console.log('error13');
    }
  });
});

app.post('/restricted/annotation/edit/ref/remove', function(req, res) {
  var annotationID = req.annotationID;
  var refID = connection.escape(req.body.refID);
  var query = 'DELETE citations FROM citations INNER JOIN refs ON citations.ref_id = refs.id WHERE annotation_id = ' + annotationID + ' AND ref_id = ' + refID;
  connection.query(query);
  query = 'DELETE FROM refs WHERE annotation_id = ' + annotationID + ' AND id = ' + refID;
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/annotation/view/citation', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var query = 'SELECT ref_id FROM citations INNER JOIN refs ON citations.ref_id = refs.id WHERE annotation_id = ' + annotationID + ' AND phenotype_id = ' + phenotypeID + ' ORDER BY citations.ref_id ASC';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    var citations = [];
    for (var i = 0; i < rows.length; i++)
      citations.push({refID: rows[i].ref_id, number: null});
    res.json({ phenotypeID: phenotypeID, citations: citations });
  });
});

app.post('/restricted/annotation/edit/citation/add', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var refID = connection.escape(req.body.refID);
  var query0 = 'SELECT id FROM citations WHERE phenotype_id = ' + phenotypeID + ' AND ref_id = ' + refID + ';';
  var query1 = 'SELECT id FROM phenotypes WHERE id = ' + phenotypeID + ' AND annotation_id = ' + annotationID + ';';
  var query2 = 'SELECT id FROM refs WHERE id = ' + refID + ' AND annotation_id = ' + annotationID;
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0 && rows[1].length > 0 && rows[2].length > 0) {
      var query = 'INSERT INTO citations (`ref_id`, `phenotype_id`) VALUES (' + refID + ',' + phenotypeID + ')';
      connection.query(query);
      query = 'UPDATE phenotypes SET not_ok = 0 WHERE annotation_id = ' + annotationID + ' AND id = ' + phenotypeID;
      connection.query(query);
      res.json({ success: true });
    }
  });
});

app.post('/restricted/annotation/edit/citation/remove', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  var refID = connection.escape(req.body.refID);
  var query = 'DELETE c FROM citations c INNER JOIN refs ON c.ref_id = refs.id WHERE annotation_id = ' + annotationID + ' AND phenotype_id = ' + phenotypeID + ' AND ref_id = ' + refID;
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/annotation/edit/delete', function(req, res) {
  var annotationID = req.annotationID;
  if (req.annotationStatus <= 0)
    return res.sendStatus(403);
  var query0 = 'DELETE c FROM citations c INNER JOIN refs ON c.ref_id = refs.id WHERE annotation_id = ' + annotationID + ';';
  var query1 = 'DELETE FROM refs WHERE annotation_id = ' + annotationID + ';';
  var query2 = 'DELETE FROM phenotypes WHERE annotation_id = ' + annotationID + ';';
  var query3 = 'DELETE FROM annotations WHERE id = ' + annotationID + ';';
  var query4 = 'DELETE FROM transactions WHERE pending = 1 AND annotation_id = ' + annotationID + ';';
  connection.query(query0 + query1 + query2 + query3 + query4);
  res.json({ success: true });
});

app.post(['/restricted/annotation/edit/prof/publish', '/restricted/annotation/edit/student/publish'], function(req, res, next) {
  var annotationID = req.annotationID;
  // Prof only
  if (req.annotationStatus <= 0)
    return res.sendStatus(403);
  // Check if there is at least one phenotype
  var query0 = 'SELECT id FROM phenotypes WHERE annotation_id = ' + annotationID + ';';
  // Check if each phenotype is cited
  var query1 = 'SELECT id AS phenotypeID, (SELECT COUNT(*) FROM citations WHERE citations.phenotype_id = phenotypeID) AS numCitations FROM phenotypes WHERE annotation_id = ' + annotationID + ';';
  // Check if each ref is used
  var query2 = 'SELECT id AS refID, (SELECT COUNT(*) FROM citations WHERE citations.ref_id = refID) AS numCitations FROM refs WHERE annotation_id = ' + annotationID + ' ORDER BY id ASC;';
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    var success = false;
    var uncitedPhenotypes = false;
    var refs = [];
    if (rows[0].length > 0) {
      for (var i = 0; i < -1; i++) { // -1 was previously rows[1].length
        if (rows[1][i].numCitations == 0) {
          uncitedPhenotypes = true;
          break;
        }
      }
      for (var i = 0; i < rows[2].length; i++) {
        if (rows[2][i].numCitations == 0) {
          refs.push(i + 1);
        }
      }
      if (!uncitedPhenotypes && refs.length == 0) {
        success = true; // for now
        next();
      }
    }
    if (!success) {
      return res.json({
        success: success,
        uncitedPhenotypes: uncitedPhenotypes,
        refs: refs
      });
    }
  });
});

app.post('/restricted/annotation/edit/prof/publish', function(req, res, next) {
  var annotationID = req.annotationID;
  // Check if there is an exact duplicate
  var query0 = 'SELECT hpo, frequency, frequency_to, onset, onset_to, observed FROM phenotypes WHERE annotation_id = ' + annotationID + ' ORDER BY hpo ASC;';
  var query1 = 'SELECT pmid, hpo FROM citations INNER JOIN refs ON citations.ref_id = refs.id INNER JOIN phenotypes ON citations.phenotype_id = phenotypes.id WHERE phenotypes.annotation_id = ' + annotationID + ' ORDER BY pmid ASC, hpo ASC;';
  var query2 = 'SELECT disease_id AS diseaseID FROM annotations WHERE id = ' + annotationID;
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    var summary = '';
    for (var i = 0; i < rows[0].length; i++) {
      summary += rows[0][i].hpo + rows[0][i].frequency + rows[0][i].frequency_to + rows[0][i].onset + rows[0][i].onset_to + rows[0][i].observed;
    }
    for (var i = 0; i < rows[1].length; i++) {
      summary += rows[1][i].pmid + rows[1][i].hpo;
    }
    var query = 'SELECT id FROM annotations WHERE summary = ' + connection.escape(summary) + ' AND status = 2 AND n_of_one = 0 AND disease_id = ' + rows[2][0].diseaseID;
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (rows.length > 0) {
        return res.json({
          success: false,
          exactDuplicate: rows[0].id
        });
      } else {
        query = 'UPDATE annotations SET status = 2, date_published = NOW(), summary = ' + connection.escape(summary) + ' WHERE id = ' + annotationID;
        connection.query(query);
        query = 'DELETE l FROM likes l INNER JOIN annotations ON l.annotation_id = annotations.id WHERE l.user_id = ' + req.userID + ' AND annotations.disease_id = ' + req.diseaseID;
        connection.query(query);
        query = 'UPDATE phenotypes SET not_ok = 0 WHERE annotation_id = ' + annotationID;
        connection.query(query);
        query = 'INSERT INTO likes (`user_id`, `annotation_id`) VALUES (' + req.userID + ',' + annotationID + ')';
        connection.query(query);
        next();
      }
    });
  });
});

app.post('/restricted/annotation/edit/prof/publish', function(req, res) {
  // Send emails
  var annotationID = req.annotationID;
  // Author and disease info
  var query = 'SELECT full_name AS author, disease_id AS diseaseID, diseases.name AS diseaseName, diseases.db AS diseaseDB, diseases.db_disease AS dbDisease FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id INNER JOIN users ON annotations.user_id = users.id WHERE annotations.id = ' + annotationID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    var author = rows[0].author;
    var diseaseID = rows[0].diseaseID;
    var diseaseName = rows[0].diseaseName;
    var diseaseDB = rows[0].diseaseDB;
    var dbDisease = rows[0].dbDisease;
    // Follow
    var query0 = 'SELECT full_name AS name, email FROM users INNER JOIN follows ON users.id = follows.user_id WHERE db = ' + connection.escape(diseaseDB) + ' AND db_disease = ' + dbDisease + ' AND email_follow = 1 AND users.id != ' + req.userID + ';';
    // Like
    var query1 = 'SELECT full_name AS name, email FROM users INNER JOIN likes ON users.id = likes.user_id INNER JOIN annotations ON likes.annotation_id = annotations.id WHERE disease_id = ' + diseaseID + ' AND email_like = 1 AND users.id != ' + req.userID;
    connection.query(query0 + query1, function(err, rows) {
      var alreadyEmailed = [];
      var toEmail = rows[0].concat(rows[1]);
      for (var i = 0; i < toEmail.length; i++) {
        // Don't send duplicate emails
        if (alreadyEmailed.indexOf(toEmail[i].email) === -1) {
          alreadyEmailed.push(toEmail[i].email);
        } else {
          continue;
        }
        // Full name
        var fullName = toEmail[i].name.substr(0, toEmail[i].name.indexOf(' '));
        if (!fullName)
          fullName = toEmail[i].name;
        // Send email
        mailgun.messages().send({
          from: 'Phenotate <notifications@phenotate.org>',
          to: toEmail[i].email,
          subject: 'Phenotate Notification',
          text: 'Hi ' + fullName + ',\n' + author + ' has created a new annotation (' + annotationID + ') for ' + diseaseName + '. You can view it at http://app.phenotate.org/dashboard/in-progress/' + annotationID + '\nCheers,\nPhenotate'
        }, function (error, body) {
          if (error)
            console.log(error);
          if (body)
            console.log(body);
        });
      }
      return res.json({ success: true });
    });
  });
});

app.post('/restricted/annotation/edit/student/publish', function(req, res) {
  var annotationID = req.annotationID;
  // Check if the user has made an exact duplicate
  var query0 = 'SELECT hpo, frequency, frequency_to, onset, onset_to, observed FROM phenotypes WHERE annotation_id = ' + annotationID + ' ORDER BY hpo ASC;';
  var query1 = 'SELECT pmid, hpo FROM citations INNER JOIN refs ON citations.ref_id = refs.id INNER JOIN phenotypes ON citations.phenotype_id = phenotypes.id WHERE phenotypes.annotation_id = ' + annotationID + ' ORDER BY pmid ASC, hpo ASC;';
  var query2 = 'SELECT disease_id AS diseaseID FROM annotations WHERE id = ' + annotationID;
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    var summary = '';
    for (var i = 0; i < rows[0].length; i++) {
      summary += rows[0][i].hpo + rows[0][i].frequency + rows[0][i].frequency_to + rows[0][i].onset + rows[0][i].onset_to + rows[0][i].observed;
    }
    for (var i = 0; i < rows[1].length; i++) {
      summary += rows[1][i].pmid + rows[1][i].hpo;
    }
    var query = 'SELECT id FROM annotations WHERE summary = ' + connection.escape(summary) + ' AND status = 2 AND disease_id = ' + rows[2][0].diseaseID + ' AND user_id = ' + req.userID;
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (rows.length > 0) {
        return res.json({
          success: false,
          exactDuplicate: rows[0].id
        });
      } else {
        query0 = 'UPDATE annotations SET status = 2, date_published = NOW(), summary = ' + connection.escape(summary) + ' WHERE id = ' + annotationID + ';';
        connection.query(query);
        query1 = 'UPDATE phenotypes SET not_ok = 0 WHERE annotation_id = ' + annotationID + ';';
        connection.query(query);
        query2 = 'UPDATE transactions SET pending = 0 WHERE annotation_id = ' + annotationID;
        connection.query(query0 + query1 + query2, function(err, result) {
          updateScores();
          return res.json({ success: true });
        });
      }
    });
  });
});

app.post('/restricted/annotation/prof/like', function(req, res) {
  var annotationID = req.annotationID;
  var like = req.body.like;
  var query = 'SELECT id FROM annotations WHERE disease_id = ' + req.diseaseID + ' AND user_id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (!like && rows.length > 0)
      return res.json({ success: false });
    query = 'DELETE l FROM likes l INNER JOIN annotations ON l.annotation_id = annotations.id WHERE l.user_id = ' + req.userID + ' AND annotations.disease_id = ' + req.diseaseID;
    connection.query(query);
    if (like) {
      query = 'INSERT INTO likes (`user_id`, `annotation_id`) VALUES (' + req.userID + ',' + annotationID + ')';
      connection.query(query);
    }
    res.json({ success: true });
  });
});

app.post('/restricted/annotation/clone', function(req, res, next) {
  if (req.userLevel < 1) {
    var annotationID = req.annotationID;
    // Get class ID, then check whether we have enough annotation slots
    var query = 'SELECT class_id, disease_id FROM annotations LEFT JOIN transactions ON annotations.id = transactions.annotation_id WHERE annotations.id = ' + annotationID;
    connection.query(query, function(err, rows) {
      if (err) throw err;
      req.classID = -1;
      if (rows[0].class_id)
        req.classID = rows[0].class_id;
      var query0 = 'SELECT COUNT(annotations.id) AS total FROM annotations LEFT JOIN transactions ON annotations.id = transactions.annotation_id WHERE annotations.user_id = ' + req.userID + ' AND status = 1 AND reward = 1 AND class_id = ' + req.classID + ';';
      var query1 = 'SELECT COUNT(id) AS total FROM transactions WHERE add_annotation_slot = 1 AND user_id = ' + req.userID + ' AND class_id = ' + req.classID + ' AND pending = 0;';
      var query2 = 'SELECT COUNT(annotations.id) AS total FROM annotations WHERE status = 1 AND user_id = ' + req.userID + ' AND disease_id = ' + rows[0].disease_id + ';';
      var query3 = 'SELECT COUNT(annotations.id) AS total FROM annotations WHERE (status = 1 OR status = 2) AND user_id = ' + req.userID + ' AND disease_id = ' + rows[0].disease_id;
      connection.query(query0 + query1 + query2 + query3, function(err, rows) {
        if (err) throw err;
        if (rows[0][0].total >= rows[1][0].total + minNumAnnotationSlots || rows[2][0].total > 0 || rows[3][0].total >= maxNumAnnotationsPerDiseasePerStudent)
          return res.sendStatus(403);
        next();
      });
    });
  } else {
    next();
  }
});

app.post('/restricted/annotation/clone', function(req, res) {
  var annotationID = req.annotationID;
  // In-progress annotations cannot be cloned
  if (req.annotationStatus < 2)
    return res.sendStatus(403);
  var query = 'INSERT INTO annotations (disease_id, user_id, clone_of, status, n_of_one) SELECT disease_id, ' + req.userID + ', id, 1, n_of_one FROM annotations WHERE id = ' + annotationID;
  connection.query(query, function(err, result) {
    if (err) throw err;
    var newAnnotationID = result.insertId;
    query = 'INSERT INTO phenotypes (annotation_id, hpo, observed, frequency, frequency_to, onset, onset_to, prev_id, not_ok, specific_onset, progression, severity, temporal_pattern, spatial_pattern, laterality) SELECT ' + newAnnotationID + ', hpo, observed, frequency, frequency_to, onset, onset_to, id, 1, specific_onset, progression, severity, temporal_pattern, spatial_pattern, laterality FROM phenotypes WHERE annotation_id = ' + annotationID;
    connection.query(query);
    query = 'INSERT INTO refs (annotation_id, pmid, prev_id) SELECT ' + newAnnotationID + ', pmid, id FROM refs WHERE annotation_id = ' + annotationID;
    connection.query(query);
    query = 'INSERT INTO citations (ref_id, phenotype_id) SELECT refs.id, phenotypes.id FROM citations INNER JOIN phenotypes ON citations.phenotype_id = phenotypes.prev_id INNER JOIN refs ON citations.ref_id = refs.prev_id WHERE phenotypes.annotation_id = ' + newAnnotationID;
    connection.query(query);
    if (req.userLevel < 1) {
      // Assign reward
      query = 'INSERT INTO transactions (points, phenocash, user_id, class_id, annotation_id, reward, pending) VALUES (' + rewardInPointsForCustomAnnotationResubmission + ',' + rewardInPhenocashForCustomAnnotationResubmission + ',' + req.userID + ',' + req.classID + ',' + newAnnotationID + ',1,1)';
      connection.query(query);
    }
    res.json({ annotationID: newAnnotationID });
  });
});

app.post('/restricted/annotation/prof/share', function(req, res) {
  var annotationID = req.annotationID;
  var url = 'http://app.phenotate.org/share/';
  if (req.annotationStatus < 2)
    return res.sendStatus(403);
  var query = 'SELECT link FROM shares WHERE annotation_id = ' + annotationID + ' AND user_id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length > 0)
      return res.json({ link: url + rows[0].link });
    query = 'SELECT FLOOR(100000000 + RAND() * 899999999) AS new_link FROM shares WHERE "new_link" NOT IN (SELECT link FROM shares) LIMIT 1';
    connection.query(query, function(err, rows) {
      if (err) throw err;
      var query = 'INSERT INTO shares (`user_id`, `annotation_id`, `link`) VALUES (' + req.userID + ',' + annotationID + ',' + rows[0].new_link + ')';
      connection.query(query);
      return res.json({ link: url + rows[0].new_link });
    });
  });
});

app.post('/restricted/annotation/prof/unshare', function(req, res) {
  var annotationID = req.annotationID;
  if (req.annotationStatus < 2)
    return res.sendStatus(403);
  var query = 'DELETE FROM shares WHERE annotation_id = ' + annotationID + ' AND user_id = ' + req.userID;
  connection.query(query);
  // For temporarily-published annotations
  query = 'UPDATE annotations SET date_created = NOW() WHERE id = ' + annotationID + ' AND user_id = ' + req.userID + ' AND status = 3';
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/annotation/prof/discuss', function(req, res) {
  var annotationID = req.annotationID;
  if (req.annotationStatus < 2)
    return res.sendStatus(403);
  var query0 = 'SELECT clone_of AS cloneOf, diseases.name AS diseaseName, email, full_name AS userName, community_user_id AS communityUserID FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id INNER JOIN users ON annotations.user_id = users.id WHERE status = 2 AND annotations.id = ' + annotationID + ';';
  var query1 = 'SELECT community_user_id AS communityUserID FROM users WHERE id = ' + req.userID;
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if (rows.length < 0)
      return res.sendStatus(403);
    var content = 'Discussing [annotation ' + annotationID + '](http://app.phenotate.org/dashboard/in-progress/' + annotationID + ') by ' + rows[0][0].userName + ' <' + rows[0][0].email + '>';
    if (rows[0][0].cloneOf)
      content += '\nThis annotation is based on [annotation ' + rows[0][0].cloneOf + '](http://app.phenotate.org/dashboard/in-progress/' + rows[0][0].cloneOf + ')';
    request({
      url: 'http://community.phenotate.org/api/v1/topics/',
      json: true,
      method: 'POST',
      auth: {
        'bearer': tokenNodeBB
      },
      body: {
        cid: 5,
        title: '[Annotation ' + annotationID + '] ' + rows[0][0].diseaseName,
        content: content,
        _uid: 1
      }
    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var communityTopicID = body.payload.topicData.tid;
        // Post reply
        request({
          url: 'http://community.phenotate.org/api/v1/topics/' + communityTopicID,
          json: true,
          method: 'POST',
          auth: {
            'bearer': tokenNodeBB
          },
          body: {
            content: req.body.message,
            _uid: rows[1][0].communityUserID
          }
        }, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            // Update database
            query = 'UPDATE annotations SET community_topic_id = ' + communityTopicID + ' WHERE id = ' + annotationID;
            connection.query(query);
            // Subscribe annotation author
            request({
              url: 'http://community.phenotate.org/api/v1/topics/' + communityTopicID + '/follow',
              json: true,
              method: 'POST',
              auth: {
                'bearer': tokenNodeBB
              },
              body: {
                _uid: rows[0][0].communityUserID
              }
            });
            // Respond with topic ID
            res.json({ communityTopicID: communityTopicID });
          } else {
            request({
              url: 'http://community.phenotate.org/api/v1/topics/' + communityTopicID,
              json: true,
              method: 'DELETE',
              auth: {
                'bearer': tokenNodeBB
              },
              body: {
                _uid: 1
              }
            });
            console.log('error14');
            return res.sendStatus(403);
          }
        });
      } else {
        console.log('error15');
        return res.sendStatus(403);
      }
    });
  });
});

app.post('/restricted/annotation/system', function(req, res) {
  var annotationID = req.annotationID;
  var phenotypeID = connection.escape(req.body.phenotypeID);
  getSystem(annotationID, phenotypeID, res);
});

app.post('/restricted/annotation/compare', function(req, res, next) {
  var annotationID = req.annotationID;
  // Retrieve existing OMIM/ORDO annotation
  if (req.annotationStatus != 3) {
    var query = "SELECT db, db_disease FROM diseases WHERE id = " + req.diseaseID;
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (rows.length > 0) {
        // Look up disease name on Solr
        req.diseaseDB = rows[0].db;
        req.dbDisease = rows[0].db_disease;
        var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + rows[0].db + '&q=' + rows[0].db.toUpperCase() + '&fq=id:(%22' + rows[0].db.toUpperCase() + ':' + rows[0].db_disease + '%22)';
        if (rows[0].db == "omim")
          requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + rows[0].db + '&q=' + rows[0].db_disease;
        request({
            url: requestURL,
            json: true
          }, function (error, response, body) {
          if (!error && response.statusCode == 200 && body.rows.length > 0) {
            var query = 'SELECT id FROM annotations WHERE disease_id IN (SELECT disease_id FROM annotations WHERE id = ' + annotationID + ') AND status = 3 ORDER BY date_created DESC';
            connection.query(query, function(err, rows) {
              // Make a new annotation for temporary publishing
              if (rows.length > 0) {
                req.comparePublishTemporarilyAnnotationID = rows[0].id;
                next();
              } else {
                query = 'INSERT INTO annotations (`disease_id`,`user_id`,`status`) VALUES (' + req.diseaseID + ',' + req.userID + ',3)';
                connection.query(query, function(err, result) {
                  if (err) throw err;
                  req.comparePublishTemporarilyAnnotationID = result.insertId;
                  req.solrBody = body;
                  next();
                });
              }
            });
          } else {
            next();
          }
        });
      } else {
        next();
      }
    });
  } else {
    next();
  }
});

app.post(['/restricted/annotations/prof/new-annotation', '/restricted/annotations/student/new-annotation', '/restricted/annotation/compare'], function(req, res, next) {
  if (req.solrBody && !req.startFromScratch) {
    var annotationID = req.annotationID;
    if (req.comparePublishTemporarilyAnnotationID)
      annotationID = req.comparePublishTemporarilyAnnotationID;
    var actualSymptoms = req.solrBody.rows[0].actual_symptom;
    var actualNotSymptoms = req.solrBody.rows[0].actual_not_symptom;
    var insertedSymptoms = ['foobar'];
    if (actualSymptoms) {
      for (var i = 0; i < actualSymptoms.length; i++) {
        if (insertedSymptoms.indexOf(actualSymptoms[i]) > 0)
          continue;
        var query = 'INSERT INTO phenotypes (annotation_id, hpo, observed, not_ok, frequency, frequency_to, onset, onset_to, specific_onset, progression, severity, temporal_pattern, spatial_pattern, laterality) SELECT ' + annotationID + ',' + connection.escape(actualSymptoms[i]) + ', 1, 1, frequency, frequency_to, onset, onset_to, specific_onset, progression, severity, temporal_pattern, spatial_pattern, laterality FROM imports WHERE db = ' + connection.escape(req.diseaseDB.toUpperCase()) + ' AND db_disease = ' + req.dbDisease + ' AND hpo = ' + connection.escape(actualSymptoms[i]) + ' LIMIT 1; INSERT INTO phenotypes (annotation_id, hpo, observed, not_ok) SELECT ' + annotationID + ',' + connection.escape(actualSymptoms[i]) + ', 1, 1 FROM phenotypes WHERE NOT EXISTS (SELECT * FROM phenotypes WHERE annotation_id = ' + annotationID + ' AND hpo = ' + connection.escape(actualSymptoms[i]) + ') LIMIT 1';
        connection.query(query);
        insertedSymptoms.push(actualSymptoms[i]);
      }
    }
    if (actualNotSymptoms) {
      for (var i = 0; i < actualNotSymptoms.length; i++) {
        if (insertedSymptoms.indexOf(actualNotSymptoms[i]) > 0)
          continue;
        var query = 'INSERT INTO phenotypes (annotation_id, hpo, observed, not_ok) VALUES (' + annotationID + ',' + connection.escape(actualNotSymptoms[i]) + ', 0, 1)';
        connection.query(query);
        insertedSymptoms.push(actualNotSymptoms[i]);
      }
    }
  }
  next();
});

app.post(['/restricted/annotations/prof/new-annotation', '/restricted/annotations/student/new-annotation'], function(req, res) {
  return res.json({ success: true, annotationID: req.annotationID });
});

app.post('/restricted/annotation/compare', function(req, res) {
  var calculateBonusFrequency = function (frequency, compareToFrequency) {
    var bonus = 0;
    // Match nearest HPO frequency: stackoverflow.com/questions/8584902/get-closest-number-out-of-array
    var hpoFrequencies = [-1, 0.01, 0.05, 0.075, 0.33, 0.5, 0.75, 0.9, 1];
    var closest = hpoFrequencies[0];
    for (var i = 0; i < hpoFrequencies.length; i++) {
      if (Math.abs(frequency - hpoFrequencies[i]) < Math.abs(frequency - closest))
        closest = hpoFrequencies[i];
    }
    frequency = closest;
    closest = hpoFrequencies[0];
    for (var i = 0; i < hpoFrequencies.length; i++) {
      if (Math.abs(compareToFrequency - hpoFrequencies[i]) < Math.abs(compareToFrequency - closest))
        closest = hpoFrequencies[i];
    }
    compareToFrequency = closest;
    switch (frequency) {
      case -1:
        switch (compareToFrequency) {
          case -1:
          case 0.05:
            bonus += 0.005;
            break;
          case 0.01:
            bonus += 0.01;
            break;
        }
        break;
      case 0.01:
        switch (compareToFrequency) {
          case -1:
            bonus += 0.01;
            break;
          case 0.01:
            bonus += 0.05;
            break;
          case 0.05:
            bonus += 0.025;
            break;
        }
        break;
      case 0.05:
        switch (compareToFrequency) {
          case -1:
            bonus += 0.01;
            break;
          case 0.01:
          case 0.075:
            bonus += 0.035;
            break;
          case 0.05:
            bonus += 0.05;
            break;
        }
        break;
      case 0.075:
        switch (compareToFrequency) {
          case -1:
            bonus += 0.01;
            break;
          case 0.01:
            bonus += 0.015;
            break;
          case 0.05:
            bonus += 0.04;
            break;
          case 0.075:
            bonus += 0.05;
            break;
        }
        break;
      case 0.33:
        switch (compareToFrequency) {
          case -1:
          case 0.075:
            bonus += 0.01;
            break;
          case 0.5:
            bonus += 0.025;
            break;
          case 0.33:
            bonus += 0.05;
            break;
        }
        break;
      case 0.5:
        switch (compareToFrequency) {
          case -1:
            bonus += 0.01;
            break;
          case 0.33:
            bonus += 0.025;
            break;
          case 0.5:
            bonus += 0.05;
            break;
          case 0.75:
            bonus += 0.015;
            break;
        }
        break;
      case 0.75:
        switch (compareToFrequency) {
          case -1:
            bonus += 0.01;
            break;
          case 0.5:
          case 0.9:
            bonus += 0.025;
            break;
          case 0.75:
            bonus += 0.05;
            break;
        }
        break;
      case 0.9:
        switch (compareToFrequency) {
          case -1:
            bonus += 0.01;
            break;
          case 0.75:
          case 1:
            bonus += 0.035;
            break;
          case 0.9:
            bonus += 0.05;
            break;
        }
        break;
      case 1:
        switch (compareToFrequency) {
          case -1:
            bonus += 0.01;
            break;
          case 0.9:
            bonus += 0.035;
            break;
          case 1:
            bonus += 0.05;
            break;
        }
        break;
    }
    return bonus;
  };
  var calculateBonusOnset = function (onset, compareToOnset) {
    var bonus = 0;
    switch (onset) {
      case '-1':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.005;
            break;
        }
        break;
      case 'HP:0030674':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.01;
            break;
          case 'HP:0030674':
            bonus += 0.05;
            break;
          case 'HP:0003577':
            bonus += 0.045;
            break;
          case 'HP:0003623':
            bonus += 0.015;
            break;
        }
        break;
      case 'HP:0003577':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.01;
            break;
          case 'HP:0030674':
            bonus += 0.045;
            break;
          case 'HP:0003577':
            bonus += 0.05;
            break;
          case 'HP:0003623':
            bonus += 0.03;
            break;
        }
        break;
      case 'HP:0003623':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.01;
            break;
          case 'HP:0030674':
            bonus += 0.02;
            break;
          case 'HP:0003577':
          case 'HP:0003593':
            bonus += 0.03;
            break;
          case 'HP:0003623':
            bonus += 0.05;
            break;
        }
        break;
      case 'HP:0003593':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.01;
            break;
          case 'HP:0003577':
            bonus += 0.015;
            break;
          case 'HP:0003623':
            bonus += 0.03;
            break;
          case 'HP:0003593':
            bonus += 0.05;
            break;
          case 'HP:0011463':
            bonus += 0.025;
            break;
        }
        break;
      case 'HP:0011463':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.01;
            break;
          case 'HP:0003593':
            bonus += 0.03;
            break;
          case 'HP:0011463':
            bonus += 0.05;
            break;
          case 'HP:0003621':
            bonus += 0.02;
            break;
        }
        break;
      case 'HP:0003621':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.01;
            break;
          case 'HP:0011463':
            bonus += 0.025;
            break;
          case 'HP:0003621':
            bonus += 0.05;
            break;
          case 'HP:0003581':
            bonus += 0.02;
            break;
        }
        break;
      case 'HP:0003581':
        switch (compareToOnset) {
          case '-1':
            bonus += 0.01;
            break;
          case 'HP:0003621':
            bonus += 0.02;
            break;
          case 'HP:0003581':
            bonus += 0.05;
            break;
        }
        break;
    }
    return bonus;
  };
  var minCompareToAuthorLevel = (req.userLevel > 0) ? 0 : 1;
  // Check if compareToAnnotationID is valid, and, if not, look for a suitable one
  var annotationID = req.annotationID;
  var compareToAnnotationID = req.body.compareToAnnotationID;
  var suggestAnnotationID = -1;
  if (req.body.suggestAnnotationID)
    suggestAnnotationID = connection.escape(req.body.suggestAnnotationID);
  console.log("BEFORE: " + annotationID + " VS " + compareToAnnotationID);
  // Comparable annotations
  var query0 = 'SELECT annotations.id AS annotationID, (SELECT COUNT(*) FROM likes WHERE annotation_id = annotationID) AS numLikes FROM annotations LEFT JOIN users ON annotations.user_id = users.id WHERE status = 2 AND n_of_one = 0 AND disease_id IN (SELECT disease_id FROM annotations WHERE annotations.id = ' + annotationID + ') AND annotations.id != ' + annotationID + ' AND level >= ' + minCompareToAuthorLevel + ';';
  // This annotation
  var query1 = 'SELECT id AS annotationID, clone_of AS cloneOf, compare_to_annotation_id AS compareToAnnotationID, status, user_id FROM annotations WHERE id = ' + annotationID + ';';
  // For reversing annotation comparison order, if student is comparing a third-party annotation against his/her own
  var query2 = 'SELECT id AS annotationID, compare_to_annotation_id AS compareToAnnotationID FROM annotations WHERE compare_to_annotation_id = ' + annotationID + ';';
  // Exercise with this disease ongoing? For blocking comparsons in grab bag
  var query3 = 'SELECT COUNT(problems.id) AS total FROM problems LEFT JOIN exercises ON problems.exercise_id = exercises.id LEFT JOIN diseases ON problems.disease_id = diseases.id WHERE disease_id IN (SELECT disease_id FROM annotations WHERE id = ' + annotationID + ') AND date_start IS NOT NULL AND date_start <= NOW() AND (date_end IS NULL OR date_end > NOW());';
  // Suggested annotation available? Used when student is comparing a third-party annotation against his/her own for grab bag
  var query4 = 'SELECT annotations.id AS annotationID FROM annotations WHERE annotations.id = ' + suggestAnnotationID + ' AND user_id = ' + req.userID + ' AND disease_id IN (SELECT disease_id FROM annotations WHERE annotations.id = ' + annotationID + ');';
  // Student has published at least one annotation of this disease for grab bag? For allowing comparisons even if current annotation is in-progress
  var query5 = 'SELECT COUNT(annotations.id) AS total FROM annotations WHERE user_id = ' + req.userID + ' AND disease_id IN (SELECT disease_id FROM annotations WHERE annotations.id = ' + annotationID + ') AND status = 2;';
  connection.query(query0 + query1 + query2 + query3 + query4 + query5, function(err, rows) {
    if (err) throw err;
    var mostLikes = -1;
    var mostLikesAnnotationID = rows[1][0].annotationID;
    var found = false;
    var studentComparingOwnAnnotation = false;
    for (var i = 0; i < rows[0].length; i++) {
      if (compareToAnnotationID == rows[0][i].annotationID) {
        found = true;
        break;
      }
      if (rows[0][i].numLikes > mostLikes) {
        mostLikes = rows[0][i].numLikes;
        mostLikesAnnotationID = rows[0][i].annotationID;
      }
    }
    if (req.comparePublishTemporarilyAnnotationID && compareToAnnotationID == req.comparePublishTemporarilyAnnotationID)
      found = true;
    if (req.annotationStatus < 0 && annotationID == compareToAnnotationID)
      found = true;
    if (!found) {
      if (rows[1][0].cloneOf && req.userLevel > 0) {
        compareToAnnotationID = rows[1][0].cloneOf;
      } else if (rows[1][0].compareToAnnotationID) {
        compareToAnnotationID = rows[1][0].compareToAnnotationID;
      } else if (annotationID != mostLikesAnnotationID) {
        compareToAnnotationID = mostLikesAnnotationID;
      } else if (req.comparePublishTemporarilyAnnotationID) {
        compareToAnnotationID = req.comparePublishTemporarilyAnnotationID;
      } else {
        compareToAnnotationID = annotationID
      }
    }
    if (req.userLevel < 1) {
      console.log("A");
      if (rows[1][0].status >= 2 || rows[5][0].total > 0) {
        console.log("B");
        if (rows[1][0].user_id != req.userID && rows[4].length > 0) {
          console.log("Z");
          compareToAnnotationID = annotationID;
          annotationID = rows[4][0].annotationID;
          studentComparingOwnAnnotation = true;
        }
        else if (rows[1][0].user_id != req.userID) { // not your annotation
          console.log("C");
          annotationID = rows[2][0].annotationID;
          compareToAnnotationID = rows[2][0].compareToAnnotationID;
        } else if (rows[3][0].total > 0) { // comparison prohibited
          console.log("D");
          compareToAnnotationID = rows[1][0].annotationID;
        } else {
          studentComparingOwnAnnotation = true;
        }
      } else {
        console.log("E");
        if (rows[1][0].compareToAnnotationID) {
          console.log("F");
          compareToAnnotationID = rows[1][0].compareToAnnotationID;
        } else {
          console.log("G");
          compareToAnnotationID = rows[1][0].annotationID;
        }
      }
    }
    console.log("AFTER: " + annotationID + " VS " + compareToAnnotationID);
    var query0 = 'SELECT annotations.id AS annotationID, exercise_id AS exerciseID, class_id AS classID, exercises.name AS exerciseName, diseases.name AS diseaseName, db AS diseaseDB, status, full_name AS userName, score, released, memo, compare_to_annotation_id AS compareToAnnotationID FROM annotations LEFT JOIN exercises ON annotations.exercise_id = exercises.id INNER JOIN diseases ON annotations.disease_id = diseases.id INNER JOIN users ON annotations.user_id = users.id WHERE annotations.id = ' + annotationID + ';';
    var query1 = 'SELECT annotations.id AS annotationID, full_name AS userName FROM annotations INNER JOIN users ON annotations.user_id = users.id WHERE exercise_id IN (SELECT exercise_id FROM annotations WHERE annotations.id = ' + annotationID + ') AND status = -2 GROUP BY user_id;';
    var query2 = 'SELECT annotations.id AS annotationID, (SELECT COUNT(*) FROM likes WHERE annotation_id = annotationID) AS numLikes FROM annotations LEFT JOIN users ON annotations.user_id = users.id WHERE status = 2 AND n_of_one = 0 AND level >= ' + minCompareToAuthorLevel + ' AND annotations.id != ' + annotationID + ' AND disease_id IN (SELECT disease_id FROM annotations WHERE annotations.id = ' + annotationID + ');';
    var query3 = 'SELECT hpo, observed, frequency, frequency_to AS frequencyTo, onset, onset_to AS onsetTo, system AS systemHPO, specific_onset AS specificOnset, progression, severity, temporal_pattern AS temporalPattern, spatial_pattern AS spatialPattern, laterality FROM phenotypes WHERE annotation_id = ' + annotationID + ' AND system IS NOT NULL;';
    var query4 = 'SELECT hpo, observed, frequency, frequency_to AS frequencyTo, onset, onset_to AS onsetTo, system AS systemHPO, specific_onset AS specificOnset, progression, severity, temporal_pattern AS temporalPattern, spatial_pattern AS spatialPattern, laterality FROM phenotypes WHERE annotation_id = ' + compareToAnnotationID + ' AND system IS NOT NULL;';
    var query5 = 'SELECT annotations.id AS annotationID, name AS diseaseName FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE exercise_id IN (SELECT exercise_id FROM annotations WHERE annotations.id = ' + annotationID + ') AND user_id IN (SELECT user_id FROM annotations WHERE annotations.id = ' + annotationID + ');';
    var query6 = 'SELECT hpo AS systemHPO, score AS systemScore, memo AS systemComment FROM system_scores WHERE annotation_id = ' + annotationID + ' AND compare_to_annotation_id = ' + compareToAnnotationID + ';';
    var query7 = 'SELECT COUNT(*) AS numLikes FROM likes WHERE annotation_id = ' + compareToAnnotationID + ';';
    var query8 = 'SELECT id, annotation_id FROM phenotypes WHERE (annotation_id = ' + annotationID + ' OR annotation_id = ' + compareToAnnotationID + ') AND system IS NULL AND modifier = 0';
    connection.query(query0 + query1 + query2 + query3 + query4 + query5 + query6 + query7 + query8, function(err, rows) {
      if (err) throw err;
      // Null systems for one or more phenotypes?
      if (rows[8].length > 0) {
        for (var i = 0; i < rows[8].length; i++)
          getSystem(rows[8][i].annotation_id, rows[8][i].id, null);
        return res.json({tryAgainLater: true});
      }
      // All submissions and annotations
      var submissions = [];
      var annotations = [];
      if (req.userLevel > 0 || studentComparingOwnAnnotation) {
        for (var i = 0; i < rows[1].length; i++) {
          submissions.push({
            annotationID: rows[1][i].annotationID,
            userName: rows[1][i].userName
          });
        }
        for (var i = 0; i < rows[2].length; i++) {
          annotations.push({
            annotationID: rows[2][i].annotationID,
            numLikes: rows[2][i].numLikes
          });
        }
        if (req.annotationStatus != 3 && req.comparePublishTemporarilyAnnotationID) {
          annotations.push({
            annotationID: req.comparePublishTemporarilyAnnotationID,
            numLikes: -1
          });
        }
      }
      // Assort phenotypes into systems
      var systemHPOs = [];
      var phenotypes = [];
      var compareToPhenotypes = [];
      for (var i = 0; i < rows[3].length; i++) {
        var x = systemHPOs.indexOf(rows[3][i].systemHPO);
        if (x == -1) {
          systemHPOs.push(rows[3][i].systemHPO);
          phenotypes.push([]);
          compareToPhenotypes.push([]);
          x = systemHPOs.length - 1;
        }
        phenotypes[x].push({
          hpo: rows[3][i].hpo,
          observed: rows[3][i].observed,
          frequency: rows[3][i].frequency,
          frequencyTo: rows[3][i].frequencyTo,
          onset: rows[3][i].onset,
          onsetTo: rows[3][i].onsetTo,
          phenotypeName: 'Loading…',
          phenotypeDefinition: null,
          bonus: false,
          specificOnset: rows[3][i].specificOnset,
          progression: rows[3][i].progression,
          severity: rows[3][i].severity,
          temporalPattern: rows[3][i].temporalPattern,
          spatialPattern: rows[3][i].spatialPattern,
          laterality: rows[3][i].laterality
        });
      }
      for (var i = 0; i < rows[4].length; i++) {
        var y = systemHPOs.indexOf(rows[4][i].systemHPO);
        if (y == -1) {
          systemHPOs.push(rows[4][i].systemHPO);
          phenotypes.push([]);
          compareToPhenotypes.push([]);
          y = systemHPOs.length - 1;
        }
        compareToPhenotypes[y].push({
          hpo: rows[4][i].hpo,
          observed: rows[4][i].observed,
          frequency: rows[4][i].frequency,
          frequencyTo: rows[4][i].frequencyTo,
          onset: rows[4][i].onset,
          onsetTo: rows[4][i].onsetTo,
          phenotypeName: 'Loading…',
          phenotypeDefinition: null,
          specificOnset: rows[4][i].specificOnset,
          progression: rows[4][i].progression,
          severity: rows[4][i].severity,
          temporalPattern: rows[4][i].temporalPattern,
          spatialPattern: rows[4][i].spatialPattern,
          laterality: rows[4][i].laterality
        });
      }
      var systems = [];
      for (var i = 0; i < systemHPOs.length; i++) {
        var systemScore = null;
        var systemComment = null;
        for (var j = 0; j < rows[6].length; j++) {
          if (rows[6][j].systemHPO == systemHPOs[i]) {
            systemScore = rows[6][j].systemScore;
            systemComment = rows[6][j].systemComment;
            break;
          }
        }
        systems.push({
          systemName: 'Loading…',
          systemHPO: systemHPOs[i],
          systemScore: (systemScore != null && (req.userLevel > 0 || rows[0][0].released == 1 || studentComparingOwnAnnotation)) ? systemScore : -1,
          systemScoreSet: (systemScore != null),
          systemWeight: -1,
          phenotypes: phenotypes[i],
          compareToPhenotypes: (req.userLevel > 0 || rows[0][0].released == 1 || studentComparingOwnAnnotation) ? compareToPhenotypes[i] : [],
          systemComment: (req.userLevel > 0 || rows[0][0].released == 1) ? systemComment : null
        });
      }
      // Diseases
      var diseases = [];
      for (var i = 0; i < rows[5].length; i++) {
        diseases.push({
          annotationID: rows[5][i].annotationID,
          diseaseName: rows[5][i].diseaseName
        });
      }
      // Response
      var comparison = {
        annotationID: rows[0][0].annotationID,
        compareToAnnotationID: parseInt(compareToAnnotationID, 10),
        compareToNumLikes: (compareToAnnotationID == req.comparePublishTemporarilyAnnotationID) ? -1 : rows[7][0].numLikes,
        exerciseID: rows[0][0].exerciseID,
        exerciseName: rows[0][0].exerciseName,
        classID: rows[0][0].classID,
        diseaseDB: rows[0][0].diseaseDB,
        diseaseName: rows[0][0].diseaseName,
        status: rows[0][0].status,
        userName: rows[0][0].userName,
        submissions: submissions,
        annotations: annotations,
        diseases: diseases,
        score: (req.userLevel > 0 || rows[0][0].released == 1) ? rows[0][0].score : 0,
        released: (rows[0][0].released == 1),
        memo: rows[0][0].memo,
        standard: (compareToAnnotationID == rows[0][0].compareToAnnotationID),
        systems: systems
      };
      // UI score
      var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?q=HP&fq=id:(%22';
      var usedPhenotypes = [];
      for (var i = 0; i < rows[3].length; i++) {
        if (i != 0)
          requestURL += '%22%20OR%20%22';
        requestURL += encodeURIComponent(rows[3][i].hpo);
        usedPhenotypes.push(rows[3][i].hpo);
      }
      for (var i = 0; i < rows[4].length; i++) {
        if (usedPhenotypes.indexOf(rows[4][i].hpo) == -1)
          requestURL += '%22%20OR%20%22' + encodeURIComponent(rows[4][i].hpo);
      }
      requestURL += '%22)&vocabulary=hpo&rows=' + (rows[3].length + rows[4].length);
      request({
          url: requestURL,
          json: true
        }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          for (var i = 0; i < comparison.systems.length; i++) {
            if (comparison.systems[i].systemScore != -1)
              continue;
            var termCategoryObserved = [];
            var compareToTermCategoryObserved = [];
            var termCategoryNotObserved = [];
            var compareToTermCategoryNotObserved = [];
            var numPhenotypesInclDuplicatesObserved = 0;
            var numPhenotypesInclDuplicatesNotObserved = 0;
            for (var j = 0; j < body.rows.length; j++) {
              for (var k = 0; k < comparison.systems[i].phenotypes.length; k++) {
                if (body.rows[j].id == comparison.systems[i].phenotypes[k].hpo && comparison.systems[i].phenotypes[k].observed == 1) {
                  termCategoryObserved.push(comparison.systems[i].phenotypes[k].hpo);
                  termCategoryObserved = termCategoryObserved.concat(body.rows[j].term_category);
                  numPhenotypesInclDuplicatesObserved++;
                }
                if (body.rows[j].id == comparison.systems[i].phenotypes[k].hpo && comparison.systems[i].phenotypes[k].observed == 0) {
                  termCategoryNotObserved.push(comparison.systems[i].phenotypes[k].hpo);
                  termCategoryNotObserved = termCategoryNotObserved.concat(body.rows[j].term_category);
                  numPhenotypesInclDuplicatesNotObserved++;
                }
              }
              for (var k = 0; k < comparison.systems[i].compareToPhenotypes.length; k++) {
                if (body.rows[j].id == comparison.systems[i].compareToPhenotypes[k].hpo && comparison.systems[i].compareToPhenotypes[k].observed == 1) {
                  compareToTermCategoryObserved.push(comparison.systems[i].compareToPhenotypes[k].hpo);
                  compareToTermCategoryObserved = compareToTermCategoryObserved.concat(body.rows[j].term_category);
                  numPhenotypesInclDuplicatesObserved++;
                }
                if (body.rows[j].id == comparison.systems[i].compareToPhenotypes[k].hpo && comparison.systems[i].compareToPhenotypes[k].observed == 0) {
                  compareToTermCategoryNotObserved.push(comparison.systems[i].compareToPhenotypes[k].hpo);
                  compareToTermCategoryNotObserved = compareToTermCategoryNotObserved.concat(body.rows[j].term_category);
                  numPhenotypesInclDuplicatesNotObserved++;
                }
              }
            }
            unique(termCategoryObserved);
            unique(compareToTermCategoryObserved);
            unique(termCategoryNotObserved);
            unique(compareToTermCategoryNotObserved);
            var termCategoryObservedIntersection = intersection(termCategoryObserved, compareToTermCategoryObserved);
            var termCategoryObservedUnion = union(termCategoryObserved, compareToTermCategoryObserved);
            var termCategoryNotObservedIntersection = intersection(termCategoryNotObserved, compareToTermCategoryNotObserved);
            var termCategoryNotObservedUnion = union(termCategoryNotObserved, compareToTermCategoryNotObserved);
            var scoreObserved = (termCategoryObservedUnion.length > 0) ? numPhenotypesInclDuplicatesObserved / (numPhenotypesInclDuplicatesObserved + numPhenotypesInclDuplicatesNotObserved) * (termCategoryObservedIntersection.length / termCategoryObservedUnion.length) : 0;
            var scoreNotObserved = (termCategoryNotObservedUnion.length > 0) ? numPhenotypesInclDuplicatesNotObserved / (numPhenotypesInclDuplicatesObserved + numPhenotypesInclDuplicatesNotObserved) * (termCategoryNotObservedIntersection.length / termCategoryNotObservedUnion.length) : 0;
            comparison.systems[i].systemScore = Math.ceil((scoreObserved + scoreNotObserved) * 100) / 100;
            // Bonus
            for (var j = 0; j < comparison.systems[i].phenotypes.length; j++) {
              for (var k = 0; k < comparison.systems[i].compareToPhenotypes.length; k++) {
                if (comparison.systems[i].phenotypes[j].observed == 1 && comparison.systems[i].compareToPhenotypes[k].observed == 1 && comparison.systems[i].phenotypes[j].hpo == comparison.systems[i].compareToPhenotypes[k].hpo && comparison.exerciseID != null) {
                  var bonus = 0;
                  var frequency = comparison.systems[i].phenotypes[j].frequency;
                  var frequencyTo = comparison.systems[i].phenotypes[j].frequencyTo;
                  var compareToFrequency = comparison.systems[i].compareToPhenotypes[k].frequency;
                  var compareToFrequencyTo = comparison.systems[i].compareToPhenotypes[k].frequencyTo;
                  if (frequencyTo != -1 && compareToFrequencyTo != -1) {
                    bonus += calculateBonusFrequency(frequency, compareToFrequency) + calculateBonusFrequency(frequencyTo, compareToFrequencyTo);
                  } else if (frequencyTo == -1 && compareToFrequencyTo != -1) {
                    bonus += Math.max(calculateBonusFrequency(frequency, compareToFrequency), calculateBonusFrequency(frequency, compareToFrequencyTo));
                  } else if (frequencyTo != -1 && compareToFrequencyTo == -1) {
                    bonus += Math.max(calculateBonusFrequency(frequency, compareToFrequency), calculateBonusFrequency(frequencyTo, compareToFrequency));
                  } else {
                    bonus += calculateBonusFrequency(frequency, compareToFrequency);
                  }
                  var onset = comparison.systems[i].phenotypes[j].onset;
                  var onsetTo = comparison.systems[i].phenotypes[j].onsetTo;
                  var compareToOnset = comparison.systems[i].compareToPhenotypes[k].onset;
                  var compareToOnsetTo = comparison.systems[i].compareToPhenotypes[k].onsetTo;
                  if (onsetTo != -1 && compareToOnsetTo != -1) {
                    bonus += calculateBonusOnset(onset, compareToOnset) + calculateBonusOnset(onsetTo, compareToOnsetTo);
                  } else if (onsetTo == -1 && compareToOnsetTo != -1) {
                    bonus += Math.max(calculateBonusOnset(onset, compareToOnset), calculateBonusOnset(onset, compareToOnsetTo));
                  } else if (onsetTo != -1 && compareToOnsetTo == -1) {
                    bonus += Math.max(calculateBonusOnset(onset, compareToOnset), calculateBonusOnset(onsetTo, compareToOnset));
                  } else {
                    bonus += calculateBonusOnset(onset, compareToOnset);
                  }
                  console.log(comparison.systems[i].phenotypes[j].hpo);
                  console.log(bonus);
                  comparison.systems[i].systemScore += bonus;
                  if (bonus >= 0.03)
                    comparison.systems[i].phenotypes[j].bonus = true;
                  if (comparison.systems[i].systemScore > 1)
                  	comparison.systems[i].systemScore = 1;
                }
              }
            }
          }
          res.json(comparison);
        } else {
          console.log('error16');
        }
      });
    });
  });
});

app.post('/restricted/annotation/prof/comment/system', function(req, res) {
  var annotationID = req.annotationID;
  var compareToAnnotationID = connection.escape(req.body.compareToAnnotationID);
  var systemHPO = connection.escape(req.body.hpo);
  var comment = connection.escape(req.body.comment);
  // First, check if compareToAnnotationID is valid (i.e. published and of the same disease)
  // Also, check if system HPO is valid (i.e. one or more phenotypes belong to it)
  var query0 = 'SELECT id FROM annotations WHERE id = ' + compareToAnnotationID + ' AND status >= 2 AND disease_id IN (SELECT disease_id FROM annotations WHERE id = ' + compareToAnnotationID + ');';
  var query1 = 'SELECT id FROM phenotypes WHERE system = ' + systemHPO + ' AND (annotation_id = ' + annotationID + ' OR annotation_id = ' + compareToAnnotationID + ')';
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if ((annotationID == compareToAnnotationID || rows[0].length > 0) && rows[1].length > 0) {
      var query = 'UPDATE system_scores SET memo = NULL WHERE annotation_id = ' + annotationID + ' AND compare_to_annotation_id = ' + compareToAnnotationID + ' AND hpo = ' + systemHPO;
      if (comment.length > 0)
        query = 'UPDATE system_scores SET memo = ' + comment + ' WHERE annotation_id = ' + annotationID + ' AND compare_to_annotation_id = ' + compareToAnnotationID + ' AND hpo = ' + systemHPO;
      connection.query(query);
    }
  });
});

app.post('/restricted/annotation/prof/score/system', function(req, res) {
  var annotationID = req.annotationID;
  var compareToAnnotationID = connection.escape(req.body.compareToAnnotationID);
  var systemHPO = connection.escape(req.body.hpo);
  var score = connection.escape(req.body.score);
  var removeCompareToAnnotation = req.body.removeCompareToAnnotation;
  if (req.body.score < 0 || req.body.score > 1)
    return res.sendStatus(403);
  // First, check if compareToAnnotationID is valid (i.e. published and of the same disease)
  // Also, check if system HPO is valid (i.e. one or more phenotypes belong to it)
  var query0 = 'SELECT id FROM annotations WHERE id = ' + compareToAnnotationID + ' AND status >= 2 AND disease_id IN (SELECT disease_id FROM annotations WHERE id = ' + compareToAnnotationID + ');';
  var query1 = 'SELECT id FROM phenotypes WHERE system = ' + systemHPO + ' AND (annotation_id = ' + annotationID + ' OR annotation_id = ' + compareToAnnotationID + ');';
  var query2 = 'SELECT memo FROM system_scores WHERE annotation_id = ' + annotationID + ' AND compare_to_annotation_id = ' + compareToAnnotationID + ' AND hpo = ' + systemHPO + ' AND memo IS NOT NULL';
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    if ((annotationID == compareToAnnotationID || rows[0].length > 0) && rows[1].length > 0) {
      var query0 = 'DELETE FROM system_scores WHERE annotation_id = ' + annotationID + ' AND compare_to_annotation_id = ' + compareToAnnotationID + ' AND hpo = ' + systemHPO + ';';
      var query1 = 'INSERT INTO system_scores (annotation_id, compare_to_annotation_id, hpo, score) VALUES (' + annotationID + ', ' + compareToAnnotationID + ', ' + systemHPO + ', ' + score + ')';
      if (rows[2].length > 0)
        query1 = 'INSERT INTO system_scores (annotation_id, compare_to_annotation_id, hpo, score, memo) VALUES (' + annotationID + ', ' + compareToAnnotationID + ', ' + systemHPO + ', ' + score + ', ' + connection.escape(rows[2][0].memo) + ')';
      connection.query(query0 + query1);
      if (removeCompareToAnnotation) {
        var query = 'UPDATE annotations SET compare_to_annotation_id = NULL WHERE status = -2 AND id = ' + annotationID;
        connection.query(query);
      }
      res.json({ success: true });
    } else {
      return res.sendStatus(403);
    }
  });
});

app.post('/restricted/annotation/prof/score/save', function(req, res) {
  var annotationID = req.annotationID;
  var compareToAnnotationID = connection.escape(req.body.compareToAnnotationID);
  var score = connection.escape(req.body.score);
  var memo = connection.escape(req.body.memo);
  if (req.body.score < 0 || req.body.score > 1)
    return res.sendStatus(403);
  if (req.body.compareToAnnotationID) {
    var query = 'SELECT id FROM annotations WHERE id = ' + compareToAnnotationID + ' AND status >= 2 AND disease_id IN (SELECT disease_id FROM annotations WHERE id = ' + annotationID + ');';
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (annotationID == compareToAnnotationID || rows.length > 0) {
        var query = 'UPDATE annotations SET score = ' + score + ', memo = ' + memo + ', compare_to_annotation_id = ' + compareToAnnotationID + ', date_graded_released = NOW() WHERE status = -2 AND id = ' + annotationID;
        connection.query(query);
        res.json({ success: true });
      } else {
        return res.sendStatus(403);
      }
    });
  } else {
    var query = 'UPDATE annotations SET score = ' + score + ', memo = ' + memo + ', compare_to_annotation_id = NULL, date_graded_released = NOW() WHERE status = -2 AND id = ' + annotationID;
    connection.query(query);
    res.json({ success: true });
  }
});

app.post('/restricted/annotation/prof/score/release', function(req, res) {
  var annotationID = req.annotationID;
  var query;
  if (req.body.release) {
    query = 'UPDATE annotations SET released = 1, date_graded_released = NOW() WHERE status = -2 AND id = ' + annotationID;
  } else {
    query = 'UPDATE annotations SET released = 0 WHERE status = -2 AND id = ' + annotationID;
  }
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/annotation/prof/score/release/all', function(req, res) {
  var annotationID = req.annotationID;
  var query = 'SELECT exercise_id AS exerciseID, user_id AS userID FROM annotations WHERE id = ' + annotationID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length > 0) {
      if (req.body.release) {
        query = 'UPDATE annotations SET released = 1, date_graded_released = NOW() WHERE status = -2 AND exercise_id = ' + rows[0].exerciseID + ' AND user_id = ' + rows[0].userID;
      } else {
        query = 'UPDATE annotations SET released = 0 WHERE status = -2 AND exercise_id = ' + rows[0].exerciseID + ' AND user_id = ' + rows[0].userID;
      }
      connection.query(query);
      res.json({ success: true });
    } else {
      return res.sendStatus(403);
    }
  });
});

app.post('/restricted/annotation/student/result', function(req, res) {
  var annotationID = req.annotationID;
  // Get reward and extras
  var query = 'SELECT points, phenocash, reward, class_id FROM transactions WHERE annotation_id = ' + annotationID + ' AND pending = 0';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0)
      return res.sendStatus(403);
      var classID = rows[0].class_id;
      var pointsReward = 0;
      var phenocashReward = 0;
      var pointsExtra = 0;
      var phenocashExtra = 0;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].reward == 1) {
          pointsReward += rows[i].points;
          phenocashReward += rows[i].phenocash;
        } else {
          pointsExtra += rows[i].points;
          phenocashExtra += rows[i].phenocash;
        }
      }
      // Get balance
      var query0 = 'SELECT SUM(points) AS pointsBalance, SUM(phenocash) AS phenocashBalance FROM transactions WHERE user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
      // Get whether comparison is possible, i.e. is there an ongoing exercise with this disease?
      var query1 = 'SELECT COUNT(problems.id) AS total FROM problems LEFT JOIN exercises ON problems.exercise_id = exercises.id LEFT JOIN diseases ON problems.disease_id = diseases.id WHERE diseases.id = ' + req.diseaseID + ' AND date_start IS NOT NULL AND date_start <= NOW() AND (date_end IS NULL OR date_end > NOW())';
      connection.query(query0 + query1, function(err, rows) {
        if (err) throw err;
        res.json({
          pointsReward: pointsReward,
          phenocashReward: phenocashReward,
          pointsExtra: pointsExtra,
          phenocashExtra: phenocashExtra,
          pointsBalance: rows[0][0].pointsBalance,
          phenocashBalance: rows[0][0].phenocashBalance,
          canCompare: !(rows[1][0].total > 0)
        });
      });
  });
  
});

app.post('/restricted/class/prof/view', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var query0 = 'SELECT name AS className, join_code AS joinCode, deletable FROM classes WHERE id = ' + classID + ' AND prof_id = ' + req.userID + ';';
  var query1 = 'SELECT id, name AS exerciseName, DATE_FORMAT(date_start, \'%Y-%m-%d\') AS dateStart, DATE_FORMAT(date_end, \'%Y-%m-%d\') AS dateEnd FROM exercises WHERE class_id = ' + classID + ' ORDER BY date_created ASC;';
  var query2 = 'SELECT user_id AS userID, full_name AS studentName FROM students INNER JOIN users ON students.user_id = users.id WHERE class_id = ' + classID + ' ORDER BY SUBSTR(full_name, INSTR(full_name, \' \'))';
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0)
      return res.sendStatus(403);
    var exercises = [];
    for (var i = 0; i < rows[1].length; i++) {
      exercises.push({
        exerciseID: rows[1][i].id,
        exerciseName: rows[1][i].exerciseName,
        dateStart: rows[1][i].dateStart,
        dateEnd: rows[1][i].dateEnd
      });
    }
    var students = [];
    for (var i = 0; i < rows[2].length; i++) {
      students.push({
        userID: rows[2][i].userID,
        studentName: rows[2][i].studentName
      });
    }
    var classe = {
      classID: req.body.classID,
      className: rows[0][0].className,
      joinCode: rows[0][0].joinCode,
      deletable: rows[0][0].deletable,
      exercises: exercises,
      students: students
    };
    res.json(classe);
  });
});

app.post('/restricted/class/prof/change-join-code', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var query = 'SELECT FLOOR(100000000 + RAND() * 899999999) AS join_code FROM classes WHERE "join_code" NOT IN (SELECT join_code FROM classes) LIMIT 1';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    query = 'UPDATE classes SET join_code = ' + rows[0].join_code + ' WHERE id = ' + classID + ' AND prof_id = ' + req.userID;
    connection.query(query);
    res.json({ joinCode: rows[0].join_code });
  });
});

app.post('/restricted/class/prof/delete', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var query = 'DELETE p FROM problems p INNER JOIN exercises ON p.exercise_id = exercises.id INNER JOIN classes ON exercises.class_id = classes.id WHERE exercises.class_id = ' + classID + ' AND classes.prof_id = ' + req.userID;
  connection.query(query);
  query = 'DELETE e FROM exercises e INNER JOIN classes ON e.class_id = classes.id WHERE e.class_id = ' + classID + ' AND classes.prof_id = ' + req.userID;
  connection.query(query);
  query = 'DELETE FROM classes WHERE id = ' + classID + ' AND prof_id = ' + req.userID;
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/class/prof/rename', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var newClassName = connection.escape(req.body.newClassName);
  var query = 'UPDATE classes SET name = ' + newClassName + ' WHERE id = ' + classID + ' AND prof_id = ' + req.userID;
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/class/prof/export-scores', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var exportType = req.body.exportType;
  var as = req.body.as;
  var responseRows = [];
  var query0 = 'SELECT classes.name AS className, exercises.id AS exerciseID, (SELECT COUNT(*) FROM problems WHERE exercise_id = exerciseID) AS numProblems, date_start FROM exercises INNER JOIN classes ON exercises.class_id = classes.id WHERE class_id = ' + classID + ' AND prof_id = ' + req.userID + ' ORDER BY exercises.id ASC;';
  var query1 = 'SELECT user_id AS userID, full_name AS userName, score, exercise_id AS exerciseID, (SELECT COUNT(*) FROM problems WHERE exercise_id = exerciseID) AS numProblems FROM annotations INNER JOIN users ON annotations.user_id = users.id INNER JOIN exercises ON annotations.exercise_id = exercises.id INNER JOIN classes ON exercises.class_id = classes.id WHERE class_id = ' + classID + ' AND prof_id = ' + req.userID + ' ORDER BY full_name ASC, exercise_id ASC, annotations.id ASC';
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0 || rows[1].length == 0)
      return;
    var exerciseIDs = [];
    // Header row
    var headerRow = [rows[0][0].className];
    for (var i = 0; i < rows[0].length; i++) {
      if (exportType == 'breakdown') {
        for (var j = 0; j < rows[0][i].numProblems; j++) {
          headerRow.push((i + 1) + '-' + (j + 1));
          exerciseIDs.push(rows[0][i].exerciseID);
        }
      } else {
        headerRow.push(i + 1);
        exerciseIDs.push(rows[0][i].exerciseID);
      }
    }
    if (exportType != 'percentages') {
      headerRow.push('SUM');
    }
    if (exportType != 'raw-scores') {
      headerRow.push('AVG');
      headerRow.push('STD');
    } else {
      headerRow.push('OF');
    }
    headerRow.push('N');
    responseRows.push(headerRow);
    var row = [rows[1][0].userName];
    var outOfRows = [null];
    var outOfRow = [null];
    var cursor = 0;
    var column = 0;
    do {
      if (cursor < rows[1].length && rows[1][cursor].exerciseID == exerciseIDs[column]) {
        switch (exportType) {
          case 'breakdown':
            row.push(rows[1][cursor].score);
            cursor++;
            break;
          case 'raw-scores':
            var numProblems = rows[1][cursor].numProblems;
            var score = 0;
            var numGradedProblems = 0;
            for (var i = 0; i < numProblems; i++) {
              if (rows[1][cursor].score != null) {
                score += rows[1][cursor].score;
                numGradedProblems++;
              }
              cursor++;
            }
            if (numGradedProblems > 0) {
              row.push(Math.round(score * 100) / 100);
              outOfRow.push(numGradedProblems);
            } else {
              row.push(null);
              outOfRow.push(null);
            }
            break;
          case 'percentages':
            var numProblems = rows[1][cursor].numProblems;
            var score = 0;
            var numGradedProblems = 0;
            for (var i = 0; i < numProblems; i++) {
              if (rows[1][cursor].score != null) {
                score += rows[1][cursor].score;
                numGradedProblems++;
              }
              cursor++;
            }
            if (numGradedProblems > 0)
              row.push(Math.round(score / numGradedProblems * 1000) / 10);
            else
              row.push(null);
            break;
        }
      } else {
        row.push(null);
        outOfRow.push(null);
      }
      column++;
      if (column == exerciseIDs.length) {
        var n = 0;
        if (exportType != 'percentages') {
          var sum = 0;
          for (var i = 0; i < exerciseIDs.length; i++) {
            if (row[i + 1] != null) {
              sum += row[i + 1];
              if (exportType != 'breakdown')
                n++;
            }
          }
          row.push(sum);
        }
        if (exportType != 'raw-scores') {
          var scores = [];
          var sum = 0;
          for (var i = 0; i < exerciseIDs.length; i++) {
            if (row[i + 1] != null) {
              sum += row[i + 1];
              scores.push(row[i + 1]);
              n++;
            }
          }
          if (exportType == 'percentages') {
            row.push(Math.round(sum / n * 10) / 10);
            row.push(Math.round(sd(scores) * 10) / 10)
          } else {
            row.push(Math.round(sum / n * 100) / 100);
            row.push(Math.round(sd(scores) * 100) / 100)
          }
        } else {
          var outOf = 0;
          var n = 0;
          for (var i = 0; i < outOfRow.length; i++) {
            if (outOfRow[i] != null) {
              outOf += outOfRow[i];
              n++;
            }
          }
          if (n > 0) {
            row.push(outOf);
          } else {
            row.push(null);
          }
        }
        row.push(n);
        responseRows.push(row);
        if (cursor < rows[1].length)
          row = [rows[1][cursor].userName];
        outOfRows.push(outOfRow);
        outOfRow = [null];
        column = 0;
      }
    } while (cursor < rows[1].length || (cursor == rows[1].length && column != 0));
    var numRows = responseRows.length;
    // Final calculation: sum
    if (exportType != 'percentages') {
      row = ['SUM'];
      for (var i = 0; i < exerciseIDs.length; i++) {
        sum = 0;
        n = 0;
        for (var j = 1; j < numRows; j++) {
          if (responseRows[j][i + 1] != null) {
            sum += responseRows[j][i + 1];
            n++;
          }
        }
        if (n > 0)
          row.push(sum);
        else
          row.push(null);
      }
      responseRows.push(row);
    }
    // Final calculation: mean
    if (exportType != 'raw-scores') {
      row = ['AVG'];
      for (var i = 0; i < exerciseIDs.length; i++) {
        sum = 0;
        n = 0;
        for (var j = 1; j < numRows; j++) {
          if (responseRows[j][i + 1] != null) {
            sum += responseRows[j][i + 1];
            n++;
          }
        }
        if (n > 0) {
          if (exportType == 'percentages')
            row.push(Math.round(sum / n * 10) / 10);
          else
            row.push(Math.round(sum / n * 100) / 100);
        } else
          row.push(null);
      }
      responseRows.push(row);
    }
    // Final calculation: standard deviation
    if (exportType != 'raw-scores') {
      row = ['STD'];
      for (var i = 0; i < exerciseIDs.length; i++) {
        scores = [];
        n = 0;
        for (var j = 1; j < numRows; j++) {
          if (responseRows[j][i + 1] != null) {
            scores.push(responseRows[j][i + 1]);
            n++;
          }
        }
        if (n > 0) {
          if (exportType == 'percentages')
            row.push(Math.round(sd(scores) * 10) / 10);
          else
            row.push(Math.round(sd(scores) * 100) / 100);
        } else
          row.push(null);
      }
      responseRows.push(row);
    }
    // Final calculation: out of
    row = ['OF'];
    if (exportType == 'raw-scores') {
      for (var i = 0; i < exerciseIDs.length; i++) {
        n = 0;
        var outOf = 0;
        for (var j = 1; j < numRows; j++) {
          outOf += outOfRows[j][i + 1];
          n++;
        }
        if (n > 0) {
          row.push(outOf);
        } else {
          row.push(null);
        }
      }
      responseRows.push(row);
    }
    // Final calculation: n
    row = ['N'];
    for (var i = 0; i < exerciseIDs.length; i++) {
      n = 0;
      for (var j = 1; j < numRows; j++) {
        if (responseRows[j][i + 1] != null) {
          n++;
        }
      }
      row.push(n);
    }
    responseRows.push(row);
    // Generate response
    var response = '';
    switch (as) {
      case 'html':
        response += '<table border="1">';
        for (var i = 0; i < responseRows.length; i++) {
          response += '<tr>';
          for (var j = 0; j < responseRows[i].length; j++) {
            response += '<td>';
            if (i == 0 || j == 0)
              response += '<strong>';
            response += responseRows[i][j];
            if (i == 0 || j == 0)
              response += '</strong>';
            response += '</td>';
          }
          response += '</tr>';
        }
        response += '</table>';
        break;
      case 'tab-separated-values':
        for (var i = 0; i < responseRows.length; i++) {
          for (var j = 0; j < responseRows[i].length; j++) {
            response += responseRows[i][j];
            if (j < responseRows[i].length - 1)
              response += '\t';
          }
          response += '\n';
        }
        break;
      case 'csv':
        for (var i = 0; i < responseRows.length; i++) {
          for (var j = 0; j < responseRows[i].length; j++) {
            response += responseRows[i][j];
            if (j < responseRows[i].length - 1)
              response += ',';
          }
          response += '\n';
        }
        break;
    }
    res.json({ response: response });
  });
});

app.post('/restricted/class/prof/remove-student', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var userID = connection.escape(req.body.userID);
  var query = 'SELECT students.id FROM students INNER JOIN classes ON students.class_id = classes.id WHERE class_id = ' + classID + ' AND user_id = ' + userID + ' AND prof_id = ' + req.userID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0)
      return res.sendStatus(403);
    var query0 = 'DELETE c FROM citations c INNER JOIN refs ON c.ref_id = refs.id INNER JOIN annotations ON refs.annotation_id = annotations.id INNER JOIN exercises ON annotations.exercise_id = exercises.id WHERE class_id = ' + classID + ' AND user_id = ' + userID + ';';
    var query1 = 'DELETE r FROM refs r INNER JOIN annotations ON r.annotation_id = annotations.id INNER JOIN exercises ON annotations.exercise_id = exercises.id WHERE class_id = ' + classID + ' AND user_id = ' + userID + ';';
    var query2 = 'DELETE p FROM phenotypes p INNER JOIN annotations ON p.annotation_id = annotations.id INNER JOIN exercises ON annotations.exercise_id = exercises.id WHERE class_id = ' + classID + ' AND user_id = ' + userID + ';';
    var query3 = 'DELETE s FROM system_scores s INNER JOIN annotations ON s.annotation_id = annotations.id INNER JOIN exercises ON annotations.exercise_id = exercises.id WHERE class_id = ' + classID + ' AND user_id = ' + userID + ';';
    var query4 = 'DELETE a FROM annotations a INNER JOIN exercises ON a.exercise_id = exercises.id WHERE class_id = ' + classID + ' AND user_id = ' + userID + ';';
    var query5 = 'DELETE FROM students WHERE user_id = ' + userID + ' AND class_id = ' + classID;
    connection.query(query0 + query1 + query2 + query3 + query4 + query5);
    res.json({ success: true });
  });
});

app.post('/restricted/class/student/view', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var query0 = 'SELECT name AS className FROM classes INNER JOIN students ON classes.id = students.class_id WHERE classes.id = ' + classID + ' AND user_id = ' + req.userID + ';';
  var query1 = 'SELECT id AS exerciseID, name AS exerciseName, date_end AS dateEnd, (SELECT COUNT(*) FROM annotations WHERE exercise_id = exerciseID AND user_id = ' + req.userID + ') AS numAnnotations, (SELECT status FROM annotations WHERE exercise_id = exerciseID AND user_id = ' + req.userID + ' LIMIT 1) AS status, (SELECT SUM(score) FROM annotations WHERE exercise_id = exerciseID AND user_id = ' + req.userID + ' AND released = 1) AS sumScore, (SELECT COUNT(*) FROM annotations WHERE exercise_id = exerciseID AND user_id = ' + req.userID + ' AND score IS NOT NULL AND released = 1) AS possibleScore FROM exercises WHERE class_id = ' + classID + ' AND date_start <= NOW() ORDER BY date_created ASC';
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0)
      return res.sendStatus(403);
    var exercises = [];
    for (var i = 0; i < rows[1].length; i++) {
      exercises.push({
        exerciseID: rows[1][i].exerciseID,
        exerciseName: rows[1][i].exerciseName,
        dateEnd: rows[1][i].dateEnd,
        dateDue: null,
        numAnnotations: parseInt(rows[1][i].numAnnotations, 10),
        status: parseInt(rows[1][i].status, 10),
        sumScore: parseFloat(rows[1][i].sumScore),
        possibleScore: parseInt(rows[1][i].possibleScore, 10),
        percentScore: Math.round(parseFloat(rows[1][i].sumScore) / parseInt(rows[1][i].possibleScore, 10) * 1000) / 10
      });
    }
    var classe = {
      classID: req.body.classID,
      className: rows[0][0].className,
      exercises: exercises
    };
    res.json(classe);
  });
});

app.post('/restricted/exercise/prof/new', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var newExerciseName = connection.escape(req.body.newExerciseName);
  if (!newExerciseName)
    return res.sendStatus(403);
  var query = 'INSERT INTO exercises (`name`, `class_id`) VALUES (' + newExerciseName + ',' + classID + ')';
  connection.query(query, function(err, result) {
    if (err) throw err;
    res.json({ exerciseID: result.insertId });
  });
});

app.post('/restricted/exercise/prof/*', function(req, res, next) {
  var exerciseID = connection.escape(req.body.exerciseID);
  var query;
  if (req.userLevel < 1) {
    // Student
    query = 'SELECT exercises.id FROM exercises INNER JOIN classes ON exercises.class_id = classes.id INNER JOIN students ON classes.id = students.class_id WHERE user_id = ' + req.userID;
  } else {
    // Prof
    query = 'SELECT exercises.id FROM exercises INNER JOIN classes ON exercises.class_id = classes.id WHERE prof_id = ' + req.userID;
  }
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0)
      return res.sendStatus(403);
    req.exerciseID = exerciseID;
    next();
  });
});

app.post('/restricted/exercise/prof/view', function(req, res) {
  var exerciseID = req.exerciseID;
  var orderSubmissionsBy = 'dateSubmitted DESC';
  if (req.body.sortMode) {
    switch (req.body.sortMode) {
      case 1:
        orderSubmissionsBy = 'dateSubmitted DESC';
        break;
      case 2:
        orderSubmissionsBy = 'dateSubmitted';
        break;
      case 3:
        orderSubmissionsBy = 'possibleScore DESC';
        break;
      case 4:
        orderSubmissionsBy = 'possibleScore';
        break;
      case 5:
        orderSubmissionsBy = 'numReleased DESC';
        break;
      case 6:
        orderSubmissionsBy = 'numReleased';
        break;
    }
  }
  var query0 = 'SELECT exercises.id, exercises.name AS exerciseName, classes.name AS className, class_id AS classID, date_start AS dateStart, date_end AS dateEnd FROM exercises INNER JOIN classes ON exercises.class_id = classes.id WHERE exercises.id = ' + exerciseID + ';';
  var query1 = 'SELECT problems.id, disease_id AS diseaseID, diseases.name AS diseaseName, db AS diseaseDB, (SELECT COUNT(*) FROM annotations WHERE disease_id = diseaseID AND status = 2 AND n_of_one = 0) AS numAnnotations, (SELECT COUNT(*) FROM annotations WHERE disease_id = diseaseID AND user_id = ' + req.userID + ') AS numMyAnnotations FROM problems INNER JOIN diseases ON problems.disease_id = diseases.id WHERE problems.exercise_id = ' + exerciseID + ' ORDER BY position ASC;';
  var query2 = 'SELECT user_id AS userID, annotations.id AS annotationID, annotations.user_id AS userID, full_name AS studentName, (SELECT SUM(released) FROM annotations WHERE exercise_id = ' + exerciseID + ' AND user_id = userID) AS numReleased, (SELECT COUNT(*) FROM annotations WHERE exercise_id = ' + exerciseID + ' AND user_id = userID) AS numAnnotations, (SELECT SUM(score) FROM annotations WHERE exercise_id = ' + exerciseID + ' AND user_id = userID) AS sumScore, (SELECT COUNT(*) FROM annotations WHERE exercise_id = ' + exerciseID + ' AND user_id = userID AND score IS NOT NULL) AS possibleScore, date_published AS dateSubmitted FROM annotations INNER JOIN users ON annotations.user_id = users.id WHERE exercise_id = ' + exerciseID + ' AND status = -2 GROUP BY user_id ORDER BY ' + orderSubmissionsBy;
  connection.query(query0 + query1 + query2, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0)
      return res.sendStatus(403);
    var problems = [];
    for (var i = 0; i < rows[1].length; i++) {
      problems.push({
        problemID: rows[1][i].id,
        diseaseDB: rows[1][i].diseaseDB,
        diseaseName: rows[1][i].diseaseName,
        numAnnotations: rows[1][i].numAnnotations,
        numMyAnnotations: rows[1][i].numMyAnnotations
      });
    }
    var submissions = [];
    for (var i = 0; i < rows[2].length; i++) {
      submissions.push({
        annotationID: rows[2][i].annotationID,
        userID: rows[2][i].userID,
        studentName: rows[2][i].studentName,
        numReleased: parseInt(rows[2][i].numReleased, 10),
        numAnnotations: parseInt(rows[2][i].numAnnotations, 10),
        sumScore: parseFloat(rows[2][i].sumScore),
        possibleScore: parseInt(rows[2][i].possibleScore, 10),
        percentScore: Math.round(parseFloat(rows[2][i].sumScore) / parseInt(rows[2][i].possibleScore, 10) * 1000) / 10,
        dateSubmitted: rows[2][i].dateSubmitted,
        dateSubmittedFormatted: null
      });
    }
    var exercise = {
      exerciseID: req.body.exerciseID,
      exerciseName: rows[0][0].exerciseName,
      dateStart: rows[0][0].dateStart,
      dateEnd: rows[0][0].dateEnd,
      className: rows[0][0].className,
      classID: rows[0][0].classID,
      problems: problems,
      submissions: submissions
    };
    res.json(exercise);
  });
});

app.post('/restricted/exercise/prof/rename', function(req, res) {
  var exerciseID = req.exerciseID;
  var newExerciseName = connection.escape(req.body.newExerciseName);
  var query = 'UPDATE exercises SET exercises.name = ' + newExerciseName + ' WHERE exercises.id = ' + exerciseID;
  connection.query(query);
  res.json({ success: true });
});

app.post('/restricted/exercise/prof/other-exercises', function(req, res) {
  var exerciseID = req.exerciseID;
  var query = 'SELECT exercises.id AS exerciseID, exercises.name AS exerciseName, classes.name AS className FROM exercises INNER JOIN classes ON exercises.class_id = classes.id WHERE exercises.id != ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL)';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0)
      return res.sendStatus(403);
    var otherExercises = [];
    for (var i = 0; i < rows.length; i++) {
      otherExercises.push({
        exerciseID: rows[i].exerciseID,
        exerciseName: rows[i].exerciseName,
        className: rows[i].className
      });
    }
    res.json({ otherExercises: otherExercises });
  });
});

app.post('/restricted/exercise/prof/start-date', function(req, res) {
  var exerciseID = req.exerciseID;
  var date;
  try {
    date = parseDate(req.body.date);
  } catch (e) {
    return res.sendStatus(403);
  }
  if (date < new Date()) {
    return res.sendStatus(403);
  }
  var query0 = 'SELECT date_start AS dateStart FROM exercises WHERE id = ' + exerciseID + ';';
  var query1 = 'UPDATE exercises SET date_start = ' + connection.escape(date) + ' WHERE exercises.id = ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL) AND (date_end > ' + connection.escape(date) + ' OR date_end IS NULL)';
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    var prevDateStart = rows[0][0].dateStart;
    var query = 'SELECT date_start AS dateStart FROM exercises WHERE id = ' + exerciseID;
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (Date.parse(rows[0].dateStart) == Date.parse(prevDateStart))
        return res.json({ date: rows[0].dateStart, changed: false });
      res.json({ date: rows[0].dateStart, changed: true });
    });
  });
});

app.post('/restricted/exercise/prof/start-now', function(req, res) {
  var exerciseID = req.exerciseID;
  var query = 'UPDATE exercises SET date_start = NOW() WHERE exercises.id = ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL)';
  connection.query(query);
  query = 'SELECT date_start AS dateStart FROM exercises WHERE id = ' + exerciseID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    res.json({ date: rows[0].dateStart });
  });
});

app.post('/restricted/exercise/prof/end-date', function(req, res) {
  var exerciseID = req.exerciseID;
  var date;
  try {
    date = parseDate(req.body.date);
  } catch (e) {
    return res.sendStatus(403);
  }
  if (date < new Date()) {
    return res.sendStatus(403);
  }
  var query0 = 'SELECT date_end AS dateEnd FROM exercises WHERE id = ' + exerciseID + ';';
  var query1 = 'UPDATE exercises SET date_end = ' + connection.escape(date) + ' WHERE exercises.id = ' + exerciseID + ' AND date_start IS NOT NULL AND (date_end > NOW() OR date_end IS NULL) AND date_start < ' + connection.escape(date);
  connection.query(query0 + query1, function(err, rows) {
    if (err) throw err;
    var prevDateEnd = rows[0][0].dateEnd;
    var query = 'SELECT date_end AS dateEnd FROM exercises WHERE id = ' + exerciseID;
    connection.query(query, function(err, rows) {
      if (err) throw err;
      if (Date.parse(rows[0].dateEnd) == Date.parse(prevDateEnd))
        return res.json({ date: rows[0].dateEnd, changed: false });
      res.json({ date: rows[0].dateEnd, changed: true });
    });
  });
});

app.post('/restricted/exercise/prof/end-now', function(req, res) {
  var exerciseID = req.exerciseID;
  var query = 'UPDATE exercises SET date_end = NOW() WHERE exercises.id = ' + exerciseID + ' AND date_start IS NOT NULL AND (date_end > NOW() OR date_end IS NULL) AND date_start < NOW()';
  connection.query(query);
  query = 'SELECT date_end AS dateEnd FROM exercises WHERE id = ' + exerciseID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    res.json({ date: rows[0].dateEnd });
  });
});

app.post('/restricted/exercise/prof/copy-problems', function(req, res) {
  var fromExerciseID = req.exerciseID;
  var toExerciseID = connection.escape(req.body.toExerciseID);
  var query = 'SELECT exercises.id FROM exercises WHERE exercises.id != ' + toExerciseID + ' AND (date_start > NOW() OR date_start IS NULL)';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0)
      return res.sendStatus(403);
    query = 'DELETE p FROM problems p INNER JOIN exercises ON p.exercise_id = exercises.id WHERE p.exercise_id = ' + toExerciseID + ' AND (date_start > NOW() OR date_start IS NULL)';
    connection.query(query);
    query = 'INSERT INTO problems (disease_id, exercise_id, position) SELECT disease_id, ' + toExerciseID + ', position FROM problems INNER JOIN exercises ON problems.exercise_id = exercises.id WHERE exercise_id = ' + fromExerciseID;
    connection.query(query);
    res.json({ success: true });
  });
});

app.post('/restricted/exercise/prof/delete', function(req, res, next) {
  var exerciseID = req.exerciseID;
  var query = 'SELECT id FROM exercises WHERE id = ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL)';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0)
      return res.sendStatus(403);
    var query0 = 'DELETE d FROM diseases d WHERE d.id IN (SELECT disease_id FROM problems INNER JOIN exercises ON problems.exercise_id = exercises.id WHERE problems.exercise_id = ' + exerciseID + ') AND d.id NOT IN (SELECT disease_id FROM annotations WHERE disease_id IN (SELECT disease_id FROM problems INNER JOIN exercises ON problems.exercise_id = exercises.id WHERE problems.exercise_id = ' + exerciseID + '));';
    var query1 = 'DELETE FROM problems WHERE exercise_id = ' + exerciseID + ';';
    var query2 = 'DELETE FROM exercises WHERE id = ' + exerciseID;
    connection.query(query0 + query1 + query2);
    res.json({ success: true });
  });
});

app.post('/restricted/exercise/prof/problem/*', function(req, res, next) {
  var exerciseID = req.exerciseID;
  var query = 'SELECT id FROM exercises WHERE id = ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL)';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0)
      return res.sendStatus(403);
    next();
  });
});

app.post('/restricted/exercise/prof/problem/remove', function(req, res) {
  var problemID = connection.escape(req.body.problemID);
  var exerciseID = req.exerciseID;
  var query0 = 'DELETE d FROM diseases d WHERE d.id IN (SELECT disease_id FROM problems INNER JOIN exercises ON problems.exercise_id = exercises.id WHERE problems.id = ' + problemID + ' AND problems.exercise_id = ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL)) AND d.id NOT IN (SELECT disease_id FROM annotations WHERE disease_id IN (SELECT disease_id FROM problems INNER JOIN exercises ON problems.exercise_id = exercises.id WHERE problems.id = ' + problemID + ' AND problems.exercise_id = ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL)));';
  var query1 = 'DELETE p FROM problems p INNER JOIN exercises ON p.exercise_id = exercises.id WHERE p.id = ' + problemID + ' AND p.exercise_id = ' + exerciseID + ' AND (date_start > NOW() OR date_start IS NULL)';
  connection.query(query0 + query1);
  res.json({ success: true });
});

app.post('/restricted/exercise/prof/problem/add', function(req, res, next) {
  var query = 'SELECT position FROM problems WHERE exercise_id = ' + req.exerciseID + ' ORDER BY position DESC';
  connection.query(query, function(err, rows) {
    if (err) throw err;
    if (rows.length == 0)
      req.position = 0;
    else
      req.position = parseInt(rows[0].position, 10) + 1;
    next();
  });
});

app.post('/restricted/exercise/prof/problem/add', function(req, res, next) {
  var exerciseID = req.exerciseID;
  var diseaseNameWords = req.body.diseaseName.replace(/[^a-zA-Z0-9 ]/g, '').split(' ');
  var diseaseID = diseaseNameWords[0];
  var vocabulary =  req.body.vocabulary.replace(/[^a-zA-Z ]/g, '');
  // Look up disease name on Solr
  var requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + vocabulary + '&q=' + vocabulary.toUpperCase() + '&fq=id:(%22' + vocabulary.toUpperCase() + ':' + diseaseID + '%22)';
  if (vocabulary == "omim")
    requestURL = 'https://playground.phenotips.org/get/PhenoTips/SolrService?vocabulary=' + vocabulary + '&q=' + diseaseID;
  request({
      url: requestURL,
      json: true
    }, function (error, response, body) {
    if (!error && response.statusCode == 200 && body.rows.length > 0) {
      var query = 'SELECT id FROM diseases WHERE db = ' + connection.escape(vocabulary) + ' AND db_disease = ' + body.rows[0].id.match(/\d+/)[0];
      connection.query(query, function(err, rows) {
        if (err) throw err;
        if (rows.length == 0) {
          var diseaseName;
          if (vocabulary == 'ordo') {
            diseaseName = '@' + body.rows[0].id.replace(/[^0-9]/g, '') + ' ' + body.rows[0].name;
          } else if (vocabulary == 'omim') {
            diseaseName = (body.rows[0].symbol ? body.rows[0].symbol : '') + body.rows[0].id + ' ' + body.rows[0].name;
          }
          query = 'INSERT INTO diseases (`db`,`db_disease`,`name`) VALUES (' + connection.escape(vocabulary) + ',' + body.rows[0].id.match(/\d+/)[0] + ',"' + diseaseName + '")';
          connection.query(query, function(err, result) {
            if (err) throw err;
            query = 'INSERT INTO problems (`disease_id`,`exercise_id`,`position`) VALUES (' + result.insertId + ',' + req.exerciseID + ',' + req.position + ')';
            connection.query(query, function(err, result) {
              if (err) throw err;
              req.problemID = result.insertId;
              next();
            });
          });
        } else {
          var diseaseID = rows[0].id;
          query = 'SELECT id FROM problems WHERE disease_id = ' + diseaseID + ' AND exercise_id = ' + exerciseID;
          connection.query(query, function(err, rows) {
            if (err) throw err;
            if (rows.length > 0)
              return res.sendStatus(403);
            query = 'INSERT INTO problems (`disease_id`,`exercise_id`,`position`) VALUES (' + diseaseID + ',' + req.exerciseID + ',' + req.position + ')';
            connection.query(query, function(err, result) {
              if (err) throw err;
              req.problemID = result.insertId;
              next();
            });
          });
        }
      });
    }
  });
});

app.post('/restricted/exercise/prof/problem/add', function(req, res) {
  var problemID = req.problemID;
  var query = 'SELECT problems.id AS problemID, disease_id AS diseaseID, diseases.name AS diseaseName, db AS diseaseDB, (SELECT COUNT(*) FROM annotations WHERE disease_id = diseaseID AND status = 2 AND n_of_one = 0) AS numAnnotations, (SELECT COUNT(*) FROM annotations WHERE disease_id = diseaseID AND user_id = ' + req.userID + ') AS numMyAnnotations FROM problems INNER JOIN diseases ON problems.disease_id = diseases.id WHERE problems.id = ' + problemID;
  connection.query(query, function(err, rows) {
    if (err) throw err;
    var response = {
      problemID: rows[0].problemID,
      diseaseDB: rows[0].diseaseDB,
      diseaseName: rows[0].diseaseName,
      numAnnotations: rows[0].numAnnotations,
      numMyAnnotations: rows[0].numMyAnnotations
    };
    res.json(response);
  });
});

app.post('/restricted/exercise/prof/problem/reposition', function(req, res) {
  var exerciseID = req.exerciseID;
  var problemID = connection.escape(req.body.problemID);
  var afterProblemID = connection.escape(req.body.afterProblemID);
  if (afterProblemID != 'NULL') {
    var query0 = 'UPDATE problems JOIN (SELECT position AS new_position FROM problems WHERE id = ' + afterProblemID + ') AS problems_join SET problems.position = position + 1 WHERE position > new_position AND exercise_id = ' + exerciseID + ';';
    var query1 = 'UPDATE problems JOIN (SELECT position AS new_position FROM problems WHERE id = ' + afterProblemID + ') AS problems_join SET problems.position = new_position - 1 WHERE id = ' + problemID + ' AND exercise_id = ' + exerciseID;
    connection.query(query0 + query1);
  } else {
    var query = 'UPDATE problems JOIN (SELECT position AS new_position FROM problems WHERE exercise_id = ' + exerciseID + ' ORDER BY position DESC LIMIT 1) AS problems_join SET problems.position = new_position + 1 WHERE id = ' + problemID + ' AND exercise_id = ' + exerciseID;
    connection.query(query);
  }
  res.json({ success: true });
});

app.post('/restricted/exercise/student/open', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var exerciseID = connection.escape(req.body.exerciseID);
  var query0 = 'SELECT exercises.id FROM exercises INNER JOIN classes ON exercises.class_id = classes.id INNER JOIN students ON classes.id = students.class_id WHERE exercises.id = ' + exerciseID + ' AND classes.id = ' + classID + ' AND user_id = ' + req.userID + ' AND date_start <= NOW();';
  var query1 = 'SELECT exercises.id FROM exercises INNER JOIN classes ON exercises.class_id = classes.id INNER JOIN students ON classes.id = students.class_id WHERE exercises.id = ' + exerciseID + ' AND classes.id = ' + classID + ' AND user_id = ' + req.userID + ' AND date_start <= NOW() AND (date_end IS NULL OR date_end > NOW());';
  var query2 = 'SELECT id FROM problems WHERE exercise_id = ' + exerciseID + ';';
  var query3 = 'SELECT annotations.id AS annotationID FROM annotations WHERE exercise_id = ' + exerciseID + ' AND user_id = ' + req.userID + ' ORDER BY id ASC LIMIT 1';
  connection.query(query0 + query1 + query2 + query3, function(err, rows) {
    if (err) throw err;
    if (rows[0].length == 0 || rows[2].length == 0 || (rows[1].length == 0 && rows[3].length == 0))
      return res.sendStatus(403);
    if (rows[3].length > 0)
      return res.json({ annotationID: rows[3][0].annotationID });
    var query = 'INSERT INTO annotations (disease_id, user_id, exercise_id, status) SELECT disease_id, ' + req.userID + ', ' + exerciseID + ', -1 FROM problems WHERE exercise_id = ' + exerciseID + ' ORDER BY position ASC';
    connection.query(query, function(err, result) {
      if (err) throw err;
      res.json({ annotationID: result.insertId });
    });
  });
});

app.post('/restricted/exercise/student/submit', function(req, res) {
  var exerciseID = connection.escape(req.body.exerciseID);
  var submit = req.body.submit;
  // Student only
  if (req.annotationStatus > 0)
    return res.sendStatus(403);
  // Check if there is at least one phenotype
  var query0 = 'SELECT annotations.id AS annotationID, (SELECT COUNT(*) FROM phenotypes WHERE phenotypes.annotation_id = annotationID) AS numPhenotypes, name AS diseaseName FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE exercise_id = ' + exerciseID + ' AND user_id = ' + req.userID + ';';
  // Check if each phenotype is cited
  var query1 = 'SELECT phenotypes.id AS phenotypeID, annotations.id AS annotationID, (SELECT COUNT(*) FROM citations WHERE citations.phenotype_id = phenotypeID) AS numCitations, name AS diseaseName FROM phenotypes INNER JOIN annotations ON phenotypes.annotation_id = annotations.id INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE exercise_id = ' + exerciseID + ' AND user_id = ' + req.userID + ' ORDER BY diseaseName;';
  // Check if each ref is used
  var query2 = 'SELECT refs.id AS refID, annotations.id AS annotationID, (SELECT COUNT(*) FROM citations WHERE citations.ref_id = refID) AS numCitations, name AS diseaseName FROM refs INNER JOIN annotations ON refs.annotation_id = annotations.id INNER JOIN diseases ON annotations.disease_id = diseases.id WHERE exercise_id = ' + exerciseID + ' AND user_id = ' + req.userID + ' ORDER BY diseaseName, refs.id ASC;';
  var query3 = 'SELECT name AS exerciseName FROM exercises WHERE id = ' + exerciseID;
  connection.query(query0 + query1 + query2 + query3, function(err, rows) {
    if (err) throw err;
    var missingPhenotypes = [];
    var uncitedPhenotypes = [];
    var unusedRefs = [];
    var success = false;
    var lastDiseaseName;
    var refNumber = 1;
    for (var i = 0; i < rows[0].length; i++) {
      if (rows[0][i].numPhenotypes == 0) {
        missingPhenotypes.push({
          annotationID: rows[0][i].annotationID,
          diseaseName: rows[0][i].diseaseName
        });
      }
    }
    for (var i = 0; i < rows[1].length; i++) {
      if (rows[1][i].numCitations == 0 && lastDiseaseName != rows[1][i].diseaseName) {
        uncitedPhenotypes.push({
          annotationID: rows[1][i].annotationID,
          diseaseName: rows[1][i].diseaseName
        });
        lastDiseaseName = rows[1][i].diseaseName;
      }
    }
    for (var i = 0; i < rows[2].length; i++) {
      if (lastDiseaseName != rows[2][i].diseaseName)
        refNumber = 1;
      if (rows[2][i].numCitations == 0) {
        unusedRefs.push({
          annotationID: rows[2][i].annotationID,
          diseaseName: rows[2][i].diseaseName,
          refNumber: refNumber
        });
      }
      lastDiseaseName = rows[2][i].diseaseName;
      refNumber++;
    }
    if (missingPhenotypes.length == 0 && uncitedPhenotypes.length == 0 && unusedRefs.length == 0 && submit) {
      var query = 'UPDATE annotations SET status = -2, date_published = NOW() WHERE exercise_id = ' + exerciseID + ' AND user_id = ' + req.userID;
      connection.query(query);
      success = true;
    }
    res.json({
      success: success,
      missingPhenotypes: missingPhenotypes,
      uncitedPhenotypes: uncitedPhenotypes,
      unusedRefs: unusedRefs,
      exerciseName: rows[3][0].exerciseName
    });
  });
});

app.post('/restricted/student/nickname', function(req, res) {
  var nickname = req.body.nickname;
  if (nickname.replace(/[^a-zA-Z0-9_]/g, '') != nickname || nickname.length < 3 || nickname.length > 6)
    return res.sendStatus(403);
  nickname = connection.escape(nickname);
  // Check duplicate
  var query = 'SELECT COUNT(id) AS total FROM users WHERE nickname = ' + nickname;
  connection.query(query, function(err, rows) {
    if (rows[0].total > 0)
      return res.sendStatus(403);
    query = 'UPDATE users SET nickname = ' + nickname + ' WHERE id = ' + req.userID + ' AND nickname IS NULL';
    connection.query(query, function(err, result) {
      res.json({ success: true });
    });
  });
});

app.post('/restricted/student/dashboard', function(req, res) {
  var classID = connection.escape(req.body.classID);
  var query0 = 'SELECT nickname FROM users WHERE id = ' + req.userID + ';';
  var query1 = 'SELECT SUM(points) AS pointsBalance, SUM(phenocash) AS phenocashBalance FROM transactions WHERE user_id = ' + req.userID + ' AND class_id = ' + classID + ' AND pending = 0;';
  var query2 = 'SELECT users.id AS userID, nickname, points FROM points INNER JOIN users ON points.user_id = users.id WHERE nickname IS NOT NULL AND level = 0 AND class_id = ' + classID + ' ORDER BY points DESC';
  connection.query(query0 + query1 + query2, function(err, rows) {
    // Compile leaderboard
    var leaderboard = [];
    var prevPoints = -1;
    var prevPrevPoints = -1;
    var uniqueRanks = 0;
    var leaderboardItem = null;
    var thisRanking = 0;
    var ranking = 0;
    var pointsToRankUp = 0;
    for (var i = 0; i < rows[2].length; i++) {
      if (uniqueRanks <= 10) {
        if (prevPoints != rows[2][i].points) {
          if (leaderboardItem)
            leaderboard.push(leaderboardItem);
          leaderboardItem = {
            rank: i + 1,
            nicknames: [],
            points: rows[2][i].points
          };
          uniqueRanks++;
        }
        leaderboardItem.nicknames.push(rows[2][i].nickname);
      }
      if (prevPoints != rows[2][i].points) {
        thisRanking = i + 1;
        prevPrevPoints = prevPoints;
      }
      if (rows[2][i].userID == req.userID) {
        ranking = thisRanking;
        pointsToRankUp = prevPrevPoints - rows[2][i].points;
      }
      prevPoints = rows[2][i].points;
    }
    if (uniqueRanks <= 20 && leaderboardItem)
      leaderboard.push(leaderboardItem);
    // Send result
    res.json({
      nickname: rows[0][0].nickname,
      pointsBalance: (rows[1][0].pointsBalance) ? rows[1][0].pointsBalance : 0,
      phenocashBalance: (rows[1][0].phenocashBalance) ? rows[1][0].phenocashBalance : 0,
      leaderboard: leaderboard,
      ranking: ranking,
      pointsToRankUp: pointsToRankUp,
      featuredDiseases: featuredDiseases,
      rewardInPointsForCustomAnnotation: rewardInPointsForCustomAnnotation,
      rewardInPhenocashForCustomAnnotation: rewardInPhenocashForCustomAnnotation
    });
  });
});

app.post('/restricted/prof/dashboard', function(req, res) {
  var query0 = 'SELECT annotations.id AS annotationID, diseases.db AS diseaseDB, diseases.name AS diseaseName, users.id AS authorID, full_name AS authorName, level FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id INNER JOIN users ON user_id = users.id LEFT JOIN follows ON diseases.db = follows.db AND diseases.db_disease = follows.db_disease WHERE status = 2 AND follows.user_id = ' + req.userID + ' AND n_of_one = 0 ORDER BY date_published DESC LIMIT 5;';
  var query1 = 'SELECT annotations.id AS annotationID, diseases.db AS diseaseDB, diseases.name AS diseaseName, users.id AS authorID, full_name AS authorName, level FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id INNER JOIN users ON user_id = users.id WHERE status = 2 AND n_of_one = 0 ORDER BY date_published DESC LIMIT 5;';
  var query2 = 'SELECT annotations.id AS annotationID, db AS diseaseDB, name AS diseaseName, users.id AS authorID, full_name AS authorName, level FROM annotations INNER JOIN diseases ON annotations.disease_id = diseases.id INNER JOIN users ON user_id = users.id WHERE status = 2 AND clone_of IN (SELECT id FROM annotations WHERE user_id = ' + req.userID + ') AND user_id != ' + req.userID + ' AND n_of_one = 0 ORDER BY date_published DESC LIMIT 5;';
  var query3 = 'SELECT exercises.id AS exerciseID, exercises.name AS exerciseName, classes.id AS classID, classes.name AS className, (SELECT COUNT(DISTINCT user_id) FROM annotations WHERE exercise_id = exerciseID AND status = -2) AS numSubmissions FROM exercises INNER JOIN classes ON exercises.class_id = classes.id WHERE prof_id = ' + req.userID + ' ORDER BY date_start DESC LIMIT 5';
  connection.query(query0 + query1 + query2 + query3, function(err, rows) {
    if (err) throw err;
    var watchedAnnotations = [];
    for (var i = 0; i < rows[0].length; i++) {
      watchedAnnotations.push({
        annotationID: rows[0][i].annotationID,
        diseaseDB: rows[0][i].diseaseDB,
        diseaseName: rows[0][i].diseaseName,
        authorName: rows[0][i].authorName,
        authorAdmin: (rows[0][i].authorID <= maxAdminID),
        authorProf: (rows[0][i].level > 0)
      });
    }
    var latestAnnotations = [];
    for (var i = 0; i < rows[1].length; i++) {
      latestAnnotations.push({
        annotationID: rows[1][i].annotationID,
        diseaseDB: rows[1][i].diseaseDB,
        diseaseName: rows[1][i].diseaseName,
        authorName: rows[1][i].authorName,
        authorAdmin: (rows[1][i].authorID <= maxAdminID),
        authorProf: (rows[1][i].level > 0)
      });
    }
    var cloneAnnotations = [];
    for (var i = 0; i < rows[2].length; i++) {
      cloneAnnotations.push({
        annotationID: rows[2][i].annotationID,
        diseaseDB: rows[2][i].diseaseDB,
        diseaseName: rows[2][i].diseaseName,
        authorName: rows[2][i].authorName,
        authorAdmin: (rows[2][i].authorID <= maxAdminID),
        authorProf: (rows[2][i].level > 0)
      });
    }
    var exercises = [];
    for (var i = 0; i < rows[3].length; i++) {
      exercises.push({
        exerciseID: rows[3][i].exerciseID,
        exerciseName: rows[3][i].exerciseName,
        classID: rows[3][i].classID,
        className: rows[3][i].className,
        numSubmissions: rows[3][i].numSubmissions
      });
    }
    res.json({
      watchedAnnotations: watchedAnnotations,
      latestAnnotations: latestAnnotations,
      cloneAnnotations: cloneAnnotations,
      exercises: exercises
    });
  });
});

app.listen(80, function () {
  console.log('App listening on port 80');
});
