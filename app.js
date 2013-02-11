//
// Pour faire les tests, nous remplaçons la méthode appelée lors d'un `fetch`.
// Au-lieu de monter au serveur, on retourne un Object en mémoire.
//
Backbone.sync = function (method, model, options) {
  var db = {
    '1': {
      dev: 'Alice',
      favoriteLanguages: [ {name:'javascript'}, {name:'ruby'}, {name:'python'} ]
    },
    '2': {
      dev: 'Bob',
      favoriteLanguages: [ {name:'lisp'}, {name:'haskell'}, {name:'clojure'} ]
    },
    '3': {
      dev: 'Carol',
      favoriteLanguages: [ {name:'smalltalk'}, {name:'ruby'}, {name:'coffeescript'} ]
    }
  };
  var resp = db[model.id];
  options.success(model, resp, options);
  model.trigger('sync', model, resp, options);
};

//
// Un langage a un nom. Les langages préférés d'un développeur est une
// collection de langages.
//
var Language = Backbone.Model.extend({
  defaults: { name: '' }
});

var FavoriteLanguages = Backbone.Collection.extend({
  model: Language
});

//
// Un développeur a un nom et une liste de langages préférés.
//
var Developer = Backbone.Model.extend({
  defaults: {
    dev: '',
    favoriteLanguages: new FavoriteLanguages()
  },

  // La méthode `parse` est appelée, entre autres choses, lorsqu'un document
  // JSON est retournée par la méthode `Backbone.sync`. Ici, on transforme les
  // réponses brutes JSON en collections Backbone. Il s'agit du `backbonify`...
  // De plus, on propage les événements des sous-collections vers this.
  parse: function (resp, options) {
    this.off('all', this.trigger, this);
    resp.favoriteLanguages = new FavoriteLanguages(resp.favoriteLanguages).on('all', this.trigger, this);
    return resp;
  },

  // On doit faire l'opération inverse du `parse` lorsqu'on redemande la
  // représentation JSON du modèle.
  toJSON: function () {
    var json = _.clone(this.attributes);
    json.favoriteLanguages = json.favoriteLanguages.toJSON();
    return json;
  }
});


//
// Cette vue est attachée à un élément statique du DOM. C'est une vue en lecture
// seule qui n'est mise à jour que lorsqu'un nouveau modèle est mis en place
// (événement `sync`).
//
var NameView = Backbone.View.extend({
  el: $('#nameView'),

  template: function (json) {
    return "<h1>"+ json.dev +"</h1>";
  },

  // L'événement `sync` est déclenché après `fetch`.
  initialize: function () {
    this.model.on('sync', this.render, this);
  },

  render: function () {
    this.$el.html(this.template(this.model.toJSON()));    
    return this;
  }
});

//
// La vue LangView n'est pas attachée à un élément statique du DOM. Chaque
// langage préféré de la collection a sa propre vue.
//
var LangView = Backbone.View.extend({
  tagName: 'li',

  render: function () {
    // Ici, `model` est de type `Language`.
    this.$el.html(this.model.name);
    return this;    
  }
});

//
// Cette vue est fixée à un élément statique du DOM. La vue est principalement
// concernée par les langages préférés. Par contre, lorsqu'un nouveau modèle est
// mis en place (événement `sync`), la vue doit se réabonner aux événements de
// la collection.
//
var LangCollectionView = Backbone.View.extend({
  el: $('#langCollectionView'),
  
  // Ici, le modèle est une instance de `Developer`.
  initialize: function () {
    this.model.on('sync', this.bindToCollectionAndRender, this);
    this.bindToCollection();
  },

  // On peut quand même s'abonner aux modifications de la liste.
  bindToCollection: function () {
    this.model.get('favoriteLanguages').on('change add remove', this.render, this);
  },

  bindToCollectionAndRender: function () {
    this.bindToCollection();
    this.render();
  },

  // On redessine complètement la liste html.
  render: function () {
    this.$('ul').empty();
    this.model.get('favoriteLanguages').each(this.addOne, this);
    return this;
  },

  // Comme mentionné précédemment, chaque langage a sa propre vue qui sera
  // ajoutée dans la liste.
  addOne: function (lang) {
    var view = new LangView({model:lang.toJSON()});
    this.$('ul').append(view.render().el);
  },

  // On ajoute des langages à la liste en s'abonnant aux clics du bouton...
  events: {
    'click button': 'onAddClick'
  },
  
  // ... et en ajoutant une nouvelle instance de la class `Language` dans la
  // liste de langages préférés.
  onAddClick: function (e) {
    this.model.get('favoriteLanguages').add({name:this.$('input').val()});
  }
});

//
// Le UndoStack permet de sauvegarder temporairement l'état d'un Developer.
// Lorsqu'un événement de modification est reçu (change, add ou remove), l'état
// est sauvegardé en format json. Un appel à `restore` rammène l'état précédent.
//
var UndoStack = function (options) {
  this.model = options.model;
  this.reset();
  this.startListening();
};
_.extend(UndoStack.prototype, Backbone.Events, {

  startListening: function () {
    this.listenTo(this.model, 'sync', this.reset);
    // Meme si `model` est un Developer, les événements change add et remove des
    // sous-collections sont propagées.
    this.listenTo(this.model, 'change add remove', this.push);
  },

  reset: function () {
    this.states = [];
    this.prevState = null;
    this.push({silent:true});
    this.trigger('reset');
  },

  push: function (options) {
    if (this.prevState) {
      this.states.push(this.prevState);
    }
    this.prevState = this.model.toJSON();
    if (options && ! options.silent) this.trigger('push');
  },

  canUndo: function () {
    return this.states.length > 0;
  },

  undo: function () {
    if (this.canUndo()) {
      this.stopListening();
      this.pop();
      this.model.trigger('sync');
      this.startListening();
      this.trigger('undo');
    }
  },

  pop: function () {
    this.prevState = this.states.pop();
    this.model.set(this.model.parse(_.extend({},this.prevState)));
  }
});

//
// Cette vue est abonnée aux événements d'un UndoStack. Elle affiche le bouton
// permettant d'appeler la fonction undo.
//
var UndoView = Backbone.View.extend({
  el: $('#undoView'),

  template: function () {
    return "<button"+ (this.model.canUndo() ? '' : ' disabled') +">undo</button>";
  },

  initialize: function () {
    this.model.on('reset undo push', this.render, this);
  },

  render: function () {
    this.$el.html(this.template());
    return this;
  },

  events: {
    'click button': 'onUndoClick'
  },

  onUndoClick: function () {
    this.model.undo();
  }
});

//
// Le Workspace est l'endroit où l'on initialise toutes les vues attachées à un
// éléments statique du DOM. Pour faire simple, l'instance du `Developer` en
// cours de visionnement y est conservé. Lorsque l'URL indique un nouvel `id`,
// on modifie le paramètre `id` de l'instance et on déclenche sa synchronisation
// avec le serveur (`fetch`).
//
var Workspace = Backbone.Router.extend({
  routes: {
    'developers/:id': 'findById'
  },

  initialize: function () {
    this.currentDeveloper = new Developer();
    new NameView({ model: this.currentDeveloper });
    new LangCollectionView({ model: this.currentDeveloper });

    var undoStack = new UndoStack({ model: this.currentDeveloper });
    new UndoView({ model: undoStack });

    Backbone.history.start();
  },

  findById: function (id) {
    this.currentDeveloper.id = id;
    this.currentDeveloper.fetch();
  }
});

// Go!
$(function(){
  new Workspace();
});
